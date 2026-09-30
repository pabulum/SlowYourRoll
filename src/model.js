// The expected-value model: resolve encounters, group a report's results by source,
// score each pool, and rank sources by EV.
//
//   EV = ( Σ score of items you still "want" ÷ items still in the pool ) ÷ token cost

import { WATERMARK_SLOT } from "./classes.js";
import {
  DIFF_ORDER,
  QE_DATA,
  QE_RAID_DIFFICULTIES,
  QE_RAID_DIFFICULTIES_LEGACY,
} from "./data.js";
import { canLoot, classSpecs, specId, specIdInClass } from "./loot.js";
import { lastReset, rollReward, SEASON, stepsAt, trackStep } from "./season.js";
import { simcOf, state } from "./store.js";

/**
 * Resolve an (instId, encId) pair to a display name and type. instId === -1 is a M+ dungeon.
 *
 * Returns null for sources that are genuinely not bonus-rollable: QE's negative sentinel
 * instances (crafted, reputation, timewalking, PvP), its sentinel *encounters* within a real raid
 * (trash/catalyst and world drops — see below), the instances the data build recorded in
 * `ignoredInstances` (world bosses, leveling drops, old catch-up vendors), and encounter ids inside
 * a raid we *do* know that aren't in its boss list.
 *
 * That last one is the trash case. Reports carry their own source ids — a Droptimizer especially,
 * which sims straight from Raidbots' data — and those include per-raid pseudo-encounters (trash
 * packs, catalyst) that QE never catalogues as bosses. When we have the raid, we have its boss
 * list, so an id that isn't in it isn't a boss you can bonus roll; ranking it would invent an
 * encounter and name it after its own raid. An unknown *instance* is the real new-content signal.
 *
 * An unrecognised instance resolves to a placeholder flagged `unknown` and treated as current, so a
 * day-one report still ranks instead of silently losing rows. Callers surface the flag; see
 * `buildGroups`, which collects them into `unknown` for the staleness banner.
 *
 * @param {number} instId
 * @param {number} encId
 * @returns {{type: "raid"|"dungeon", name: string, instName?: string, current: boolean, unknown?: boolean}|null}
 */
export function resolve(instId, encId) {
  if (instId === -1) {
    const dn = QE_DATA.dungeons[String(encId)];
    if (dn)
      return {
        type: "dungeon",
        name: dn,
        current: QE_DATA.currentDungeons.includes(String(encId)),
      };
    return {
      type: "dungeon",
      name: `Unknown dungeon ${encId}`,
      current: true,
      unknown: true,
    };
  }
  if (instId < 0) return null; // crafted / reputation / timewalking / PvP — never bonus-rollable
  // A raid's non-encounter drops are filed under sentinel *encounter* ids: 999 is "BoE Trash Drops
  // & Catalyst" (QE's getSourceName special-cases it for every instance) and negatives are world
  // drops catalogued against the tier they match. Nothing here drops from a boss, so none of it is
  // a roll target. Checked before the boss lookup on purpose: upstream lists 999 in a raid's boss
  // map only sometimes, and a missing entry is an upstream oversight, not new content.
  if (encId === 999 || encId < 0) return null;
  const r = QE_DATA.raids[String(instId)];
  if (!r) {
    if ((QE_DATA.ignoredInstances || []).includes(String(instId))) return null;
    return {
      type: "raid",
      name: `Unknown boss ${encId}`,
      instName: `Unknown raid ${instId}`,
      current: true,
      unknown: true,
    };
  }
  const boss = r.bosses[String(encId)];
  if (!boss) return null; // known raid, unlisted encounter — trash, not a boss (see above)
  return {
    type: "raid",
    name: boss,
    instName: r.name,
    current: QE_DATA.currentRaids.includes(String(instId)),
  };
}

// A result's sources + difficulty are shaped differently per data source.
// QE reports carry sources on the item metadata; Droptimizer results carry them inline.
/**
 * @param {import("./types.js").Board} b
 * @param {import("./types.js").Result} r
 * @returns {any[][]} each entry is [instId, encId] with an optional 3rd very-rare flag.
 */
function srcList(b, r) {
  return b.source === "droptimizer"
    ? [[r.inst, r.enc, isVR(r.item, r.inst, r.enc)]]
    : QE_DATA.items[r.item]?.s || [];
}

/**
 * Is this item a "very rare" drop from the given source?
 *
 * Display only — deliberately absent from the EV maths. "Very rare" describes the item's rate off
 * a boss kill; a bonus roll draws uniformly from the pool, so a very rare item is exactly as likely
 * as anything else in it. Discounting it here would be wrong twice over: it would understate the
 * roll, and it would hide the one case where rolling beats farming outright. Ranking it flat is the
 * point, not an oversight.
 */
export function isVR(item, inst, enc) {
  const m = QE_DATA.items[item];
  if (!m) return false;
  return m.s.some((s) => s[0] === inst && s[1] === enc && s.length > 2);
}

function diffOf(b, r) {
  return b.source === "droptimizer" ? r.diff : r.dropDifficulty;
}

/**
 * Is this board's QE report written in the 12.1 Upgrade Finder's vocabulary?
 *
 * It has to be asked per board rather than assumed per build, because reports are saved to
 * localStorage and outlive the patch that produced them. The two formats disagree about what a
 * `dropDifficulty` of 2 means — Heroic in 12.1, Normal before it — so a board saved last season and
 * one pasted this morning cannot be read off the same table.
 *
 * `dropType` is the tell. 12.1 emits three rows per item per source and labels each one; nothing
 * before it emitted the field at all. That is a fact about the payload rather than about the item,
 * so a single row anywhere in the report settles it, and no report can be half of each.
 *
 * Cached against the results array, not the board, for the same reason `baselineOf` is: reloading a
 * report replaces that array, which is exactly when the answer can change.
 *
 * @param {import("./types.js").Board} b
 */
const qeModern = new WeakMap();
export function qeIsModern(b) {
  if (!Array.isArray(b.results)) return true;
  const hit = qeModern.get(b.results);
  if (hit !== undefined) return hit;
  const v = b.results.some((r) => !!r.dropType);
  qeModern.set(b.results, v);
  return v;
}

/**
 * Are this board's scores the value of what a *roll* pays, or of what the boss *drops*?
 *
 * The question the whole page turns on, and until 12.1 there was only one answer. A report simmed
 * each item at the level its source drops it at, and where the season promotes the reward every
 * score in every pool was therefore a floor — which the cards said out loud, because there was
 * nothing else to be done about it.
 *
 * QE Live's 12.1 Upgrade Finder sims the bonus roll itself, so for those reports the floor is gone
 * and the scores are the thing. It sims that payout taken to the top of its track, i.e. after the
 * crests you'd spend on it, which is what a bonus-rolled item is actually worth to someone playing
 * the season out — and, usefully, puts every source's scores at the same finished item level, so the
 * crests each roll saves stay a separate figure (`Reward.crests`) instead of hiding inside the EV.
 *
 * A Droptimizer sims the drop, and so does any QE report from before 12.1.
 *
 * @param {import("./types.js").Board} b
 */
export function rollScored(b) {
  return b.source !== "droptimizer" && qeIsModern(b);
}

/**
 * One result's value in the board's raw unit, which for a QE report is not the field it looks like.
 *
 * A QE result carries the same upgrade three times: `rawDiff` (HPS gained), `percDiff` (that gain
 * as a percentage), and `score` — whichever of the two the person who ran the report had selected
 * under QE's own "Upgrade Finder metric" setting. That setting defaults to "Show % Upgrade", so
 * `score` on a typical report is a bare ratio like `0.0234`, and reading it as HPS understated every
 * number on this page by a factor of the character's throughput. It never reordered anything, since
 * the factor is constant across a report, but "spend your token here for 0.02 HPS" is not a figure
 * anyone can act on, and two reports saved under different settings couldn't be compared at all.
 *
 * So the metric-independent field is the one to read. `score` is kept only as a fallback for a
 * report old enough to predate `rawDiff` (QE has sent it since April 2023).
 *
 * A Droptimizer has no such ambiguity: `parseDroptimizer` computes the DPS delta itself.
 *
 * @param {import("./types.js").Result} r
 * @returns {number} HPS or DPS gained, never negative.
 */
export function scoreOf(r) {
  const v = typeof r.rawDiff === "number" ? r.rawDiff : r.score;
  return typeof v === "number" && v > 0 ? v : 0;
}

function diffRank(d) {
  d = String(d).toLowerCase();
  if (DIFF_ORDER[d] != null) return DIFF_ORDER[d];
  const n = parseInt(d, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Distinct raid difficulties present for the given board's current raids, best-first. */
export function raidDiffs(b) {
  const set = {};
  b.results.forEach((r) => {
    const rd = diffOf(b, r);
    if (rd === "" || rd == null) return;
    srcList(b, r).forEach((s) => {
      if (s[0] === -1) return;
      const info = resolve(s[0], s[1]);
      if (info && info.type === "raid" && (state.showAll || info.current))
        set[String(rd)] = 1;
    });
  });
  return Object.keys(set).sort((a, c) => diffRank(c) - diffRank(a));
}

/**
 * Human label for a difficulty value. The two report formats encode it differently: a Droptimizer
 * sends a name ("raid-mythic"), a QE report sends an index into QE's own difficulty slider.
 *
 * The index is looked up in QE's own slider. It used to be resolved by position instead — the
 * board's difficulties sorted best-first, then read off a list of rank names — which is right only
 * when a report happens to contain a run of adjacent difficulties ending at Mythic. A report with
 * Normal and Mythic in it labelled Normal "Heroic", and since `diffKey` feeds the season's reward
 * table, that mislabelling also picked the wrong upgrade track.
 *
 * *Which* slider is a per-report question: 12.1 renumbered it from eight values to four, so the
 * same index names a different difficulty either side of that release. See `qeIsModern`. Getting
 * this wrong is not cosmetic for the same reason as above — a Mythic report read on the old table
 * comes out as Normal, and the card then claims the roll pays Hero 1/6 instead of Myth 6/6.
 */
export function diffLabel(b, d) {
  d = String(d);
  if (/[a-z]/i.test(d)) {
    const t = d.split("-").pop(); // "raid-mythic" -> "mythic"
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const slider = qeIsModern(b)
    ? QE_RAID_DIFFICULTIES
    : QE_RAID_DIFFICULTIES_LEGACY;
  return slider[Number(d)] || `Diff ${d}`;
}

/**
 * Canonical difficulty key ("mythic", "heroic", …) for a board's selected difficulty, for looking
 * up what a roll at that difficulty pays.
 *
 * Two normalisations on top of the label. "(Max)" is dropped, because a maxed-out Mythic item is
 * still Mythic loot and a roll on it pays the Mythic track. "Raid Finder" becomes "lfr", which is
 * both what the season table is keyed on and what everyone calls it.
 */
export function diffKey(b, d) {
  const k = diffLabel(b, d).toLowerCase().replace(" (max)", "");
  return k === "raid finder" ? "lfr" : k;
}

/**
 * The model itself, in one place.
 *
 *   EV = ( Σ score of items you still want ÷ items still in the pool ) ÷ token cost
 *
 * Every expected value on the page comes through here — the ranking, each alternative loot spec,
 * and both branches of the vault trade. They differ only in which items they hand it, which is the
 * point: three transcriptions of one formula are three chances for them to disagree about what a
 * pool is.
 *
 * Ineligible items are dropped outright rather than counted at zero. They can't dilute a pool a
 * bonus roll is unable to draw them from.
 *
 * @param {import("./types.js").PoolItem[]} items
 * @param {number} cost  Tokens one roll here costs.
 * @returns {{inPool: import("./types.js").PoolItem[], remaining: number, num: number, ev: number}}
 */
export function priceOf(items, cost) {
  const inPool = items.filter((i) => i.elig !== false);
  const remaining = inPool.filter((i) => i.state !== "rolled").length;
  const num = inPool.reduce(
    (t, i) => t + (i.state === "want" ? i.score : 0),
    0,
  );
  return {
    inPool,
    remaining,
    num,
    ev: remaining > 0 ? num / remaining / (cost || 1) : 0,
  };
}

/**
 * The same encounter priced as if one item were in a different state — the counterfactual behind
 * the vault panel's "if you leave it / if you take it" pair. Copies rather than mutates: the branch
 * being priced is by definition not the branch the board is in.
 *
 * @param {import("./types.js").Row} row
 * @param {number} itemId
 * @param {"want"|"own"|"rolled"} itemState
 */
export function priceWith(row, itemId, itemState) {
  return priceOf(
    row.items.map((i) => (i.id === itemId ? { ...i, state: itemState } : i)),
    row.cost,
  );
}

/**
 * The same encounter, rolled as each of the character's other specs.
 *
 * Loot spec is a lever on the pool, not just a filter: dropping an item you'd never want shortens
 * the denominator and every remaining item's odds go up. The classic case is a Mistweaver at Pit of
 * Saron, where looting as Windwalker sheds Nevermelting Ice Crystal and keeps every piece of
 * leather. So each alternative is costed the same way as the current one — by re-asking eligibility
 * as that spec and handing the result to `priceOf` — and named by what it drops and what it gives up.
 *
 * Values are the report's, which only ever simmed one spec — fine for "what would I stop being
 * offered", not for "what is this worth to the other spec". Rows keep only the better options.
 */
function altSpecs(items, sp, cost, ev) {
  if (!sp) return [];
  const live = items.filter((i) => i.state !== "rolled");
  return classSpecs(sp)
    .filter((s) => s !== sp)
    .map((s) => {
      const has = (i) => (i.specs || []).includes(s);
      const p = priceOf(
        items.map((i) => ({ ...i, elig: has(i) })),
        cost,
      );
      return {
        spec: s,
        remaining: p.remaining,
        num: p.num,
        ev: p.ev,
        dodges: live
          .filter((i) => i.elig !== false && !has(i))
          .map((i) => i.name),
        gains: live
          .filter((i) => i.elig === false && has(i))
          .map((i) => i.name),
        loses: live
          .filter((i) => i.elig !== false && !has(i) && i.score > 0)
          .map((i) => i.name),
      };
    })
    .filter((a) => a.ev > ev)
    .sort((a, c) => c.ev - a.ev);
}

/**
 * Which of the character's own specs could be awarded this item. The point isn't the current spec —
 * it's the difference between them. An item only one spec can receive is an item the others dodge,
 * and dodging is half of what a loot spec is for.
 * @returns {string[]} spec ids, empty when the character's spec is unknown.
 */
function eligibleSpecs(meta, sp) {
  if (!sp) return [];
  return classSpecs(sp).filter((s) => canLoot(meta, s).ok);
}

/**
 * The item level a bonus roll on this source would actually hand you.
 *
 * @param {import("./season.js").Reward|null} reward  Where the season pays this source out, or null
 *   when it pays out the drop itself.
 * @param {number} [dropIlvl]  Item level the boss drops it at, as the report simmed it.
 * @returns {number|null} null when it can't be pinned down — either the drop level is unknown, or
 *   the season promotes the reward to a track whose item level isn't published yet.
 */
export function rollIlvlFor(reward, dropIlvl) {
  return reward ? reward.ilvl : dropIlvl || null;
}

/**
 * Would a roll here only hand you a copy of what you already have?
 *
 * Unknown means no: a roll wrongly left as Want is a visible extra line the user can click to Own,
 * while a roll wrongly marked Own drops silently out of the numerator and understates the whole
 * encounter. Only one of those two mistakes argues against itself on screen.
 *
 * @param {number|null} [ownedIlvl] Best copy the character holds, null if they hold none.
 * @param {number|null} [rollIlvl]  What the roll pays out, from `rollIlvlFor`.
 */
export function isDupe(ownedIlvl, rollIlvl) {
  return ownedIlvl != null && rollIlvl != null && ownedIlvl >= rollIlvl;
}

/**
 * The item level a copy you already hold has to beat, which is where the roll's payout *ends up*
 * rather than where it arrives.
 *
 * A 12.1 QE report prices the bonus roll as its "Upgraded Bonus Rolls" panel does — the payout taken
 * to the top of its own track, crests spent — so a Heroic roll's score is the item at ilvl 334 even
 * though the roll hands it over at 318. Judging the dupe against the 318 while printing the 334's
 * score beside it is the same item described two ways: someone holding a Hero 6/6 copy at 321 was
 * told a Heroic roll could only duplicate it, when the copy that roll leads to outclasses theirs by
 * four upgrade steps. The season's own crest table agrees — it credits a Heroic roll with *zero*
 * saved crests precisely because you climb 318→334 yourself — so the climb is assumed everywhere
 * else on the card and has to be assumed here too.
 *
 * Only where the report makes that claim. A Droptimizer, and any QE report from before 12.1, sims
 * the drop and has taken nothing to a track top, so there `scoreIlvl` is not a ceiling and the
 * payout stands on its own (see `rollScored`).
 *
 * Never *below* the payout: a report that simmed low can't make a roll worth less than it hands
 * over. And a null payout stays null, because "promoted by an unknown amount" has to keep
 * suppressing the guess rather than quietly resolving to the report's level — see `rollIlvlFor`.
 *
 * @param {number|null} [rollIlvl]   What the roll hands over, from `rollIlvlFor`.
 * @param {number|null} [scoreIlvl]  Where the pool's scores were simmed, or null where the report
 *   makes no track-top claim.
 * @returns {number|null}
 */
export function rollTopFor(rollIlvl, scoreIlvl) {
  if (rollIlvl == null) return null;
  return scoreIlvl ? Math.max(rollIlvl, scoreIlvl) : rollIlvl;
}

/**
 * The last `n` encounters of a raid, as the encounter ids that end its boss list.
 *
 * Uses the raid's recorded pull order (`order`, upstream's `bossOrder`). It used to sort by
 * encounter id on the theory that Blizzard hands out journal ids in roughly pull order — true of
 * The Voidspire, and false of the raid this season is about: Venomous Abyss ends on Coiled Altar
 * (2883) and Ula'tek (2895), but by id the last two are Lost Explorers (2894) and Ula'tek. That
 * badged the wrong boss as the one worth banking a token for, which is the single piece of advice
 * every guide leads with, so the order is now carried through from upstream rather than guessed.
 *
 * Falls back to ascending id when a raid records no order — the old behaviour, kept because it is
 * right more often than not and the alternative is showing nothing.
 *
 * @param {number|string} instId
 * @param {number} n
 * @returns {string[]} encounter ids, empty when the raid is unknown or `n` is 0.
 */
export function finalBosses(instId, n) {
  const r = QE_DATA.raids[String(instId)];
  if (!r || !n) return [];
  const order = r.order?.length
    ? r.order
    : Object.keys(r.bosses).sort((a, c) => Number(a) - Number(c));
  return order.slice(-n);
}

/**
 * Does this encounter carry the season's end-of-raid rewards? Memoised per raid.
 *
 * Gated on the season naming its tier raid, because "the last two bosses of a raid" is not a rule
 * that survives being applied to every raid on the page. Season 2 lists two: Venomous Abyss, whose
 * last two bosses are the Venomcursed tier, and Tidebound Grotto, a one-boss flex world boss that
 * has nothing to do with it — and asking for the last two bosses of a one-boss raid returns that
 * boss, so the badge landed on it. A season with no `raid` named falls back to the old behaviour of
 * treating every raid's tail as special, which is right for a season whose only raid is the tier.
 */
let specialByRaid = null;
function isSpecial(instId, encId) {
  const sp = SEASON.special;
  if (!sp) return false;
  if (sp.raid && String(instId) !== String(sp.raid)) return false;
  if (!specialByRaid) specialByRaid = {};
  const k = String(instId);
  if (!specialByRaid[k]) specialByRaid[k] = finalBosses(instId, sp.lastBosses);
  return specialByRaid[k].includes(String(encId));
}

/** Item ids per "instId:encId" source, built once on demand. */
let bySource = null;
function itemsAt(key) {
  if (!bySource) {
    bySource = {};
    Object.keys(QE_DATA.items).forEach((id) => {
      QE_DATA.items[id].s.forEach((s) => {
        const k = `${s[0]}:${s[1]}`;
        if (!bySource[k]) bySource[k] = [];
        bySource[k].push(id);
      });
    });
  }
  return bySource[key] || [];
}

/**
 * One item as it sits in a pool, before its state is decided. Both halves of a pool build these —
 * the report's own scored results and the rest of the boss's loot table — and they differ only in
 * whether there is a score and a drop level to carry.
 *
 * A report can list items this character's loot spec can't be given: QE evaluates a healer trinket
 * and the caster-DPS one beside it alike. They're kept, flagged — visible, but out of the pool,
 * since a bonus roll can't hand you one.
 *
 * @param {number|string} id
 * @param {Partial<import("./types.js").Item>} meta
 * @param {string|null} sp  Loot spec id.
 * @param {{score: number, lvl: number, scoreLvl?: number, vr?: any}} read  What the report says
 *   about this item at this source, already folded down from however many rows it sent — see
 *   `mergeRow`.
 * @returns {import("./types.js").PoolItem}
 */
function poolItem(id, meta, sp, read) {
  const lt = canLoot(meta, sp);
  // A tier token is a voucher for one slot's tier piece, in four class versions. Which of them this
  // spec would be handed is settled here; what it is *worth* needs the report, so `priceGroup` does
  // that part. Usually one candidate survives — the four are one per class — but the database
  // carries no spec list for a class with no healing spec, so a second can slip through and the
  // report's own score is what breaks the tie.
  const gives =
    lt.ok && meta.ct
      ? meta.ct.filter((c) => canLoot(QE_DATA.items[c] || {}, sp).ok)
      : null;
  return {
    id: Number(id),
    name: meta.n || `Item ${id}`,
    q: meta.q || 3,
    score: read.score,
    lvl: read.lvl,
    scoreLvl: read.scoreLvl || read.lvl,
    vr: !!read.vr,
    elig: lt.ok,
    why: lt.why || "",
    swap: lt.swap || null,
    gives: gives?.length ? gives : null,
    specs: eligibleSpecs(meta, sp),
  };
}

/**
 * How much this app wants a given row's score, when a report sends several for one item.
 *
 * A 12.1 report sends three: the drop, the drop taken to the top of its own track, and the bonus
 * roll taken to the top of *its* track. Only the last is the thing being priced here — a bonus roll
 * pays out on your Great Vault's track, so `bonus` is QE simming the exact item this app is about to
 * rank. The other two describe a different way of getting the item and belong nowhere near the EV.
 *
 * Rank rather than filter, so a report missing the row we want still yields a number: an older
 * report sends one unlabelled row per item and it is the only reading there is. Everything ties at
 * 1, and `mergeRow` falls back to the best score within a rank, which is the old behaviour exactly.
 *
 * The distinction matters more than it looks. Taking the best of the three — which is what "keep its
 * best showing" quietly did once 12.1 started sending them — lands on `bonus` by accident nearly
 * every time, since the scores climb with item level. Nearly. It is not a rule, and a rule is what
 * the numerator of every EV on the page needs.
 */
function scoreRank(r) {
  if (!r.dropType) return 1; // pre-12.1: one row per item, and it's this one
  return r.dropType === "bonus" ? 2 : 1;
}

/**
 * Fold one more of a report's rows into what we know about an item at a source.
 *
 * Two readings come out, because the card asks two different questions of them. `score`/`scoreLvl`
 * are what a roll here is worth and the item level that was simmed at — the `bonus` row. `lvl` is
 * what the boss actually drops, which is the number the item row shows next to "a bonus roll pays
 * out at" and would be nonsense if it were the promoted figure.
 *
 * @param {{score: number, lvl: number, scoreLvl: number, vr: any, rank: number}|undefined} acc
 * @param {import("./types.js").Result} r
 * @param {any} vr  Very-rare flag for this source.
 */
function mergeRow(acc, r, vr) {
  const rank = scoreRank(r),
    sc = scoreOf(r),
    lvl = r.level || 0;
  if (!acc) acc = { score: 0, lvl: 0, scoreLvl: 0, vr, rank: -1 };
  if (rank > acc.rank || (rank === acc.rank && sc > acc.score)) {
    acc.rank = rank;
    acc.score = sc;
    acc.scoreLvl = lvl;
  }
  // The drop row wins outright wherever it exists; otherwise the first row seen stands in, which is
  // all an older report gives us.
  if (r.dropType === "drop" || !acc.lvl) acc.lvl = lvl;
  return acc;
}

/**
 * Everything the report valued, keyed by item id alone.
 *
 * The pools are built by source, which is the right shape for almost everything and the wrong one
 * for a tier token: the token drops from a boss and the report scores the *piece* it is a voucher
 * for, and that piece is filed under the catalyst rather than under any encounter. So the value has
 * to be findable without a source to look it up by.
 *
 * Folded with the same `mergeRow` the pools use, so a token carries the bonus row like everything
 * else and the two can be compared. Cached against the results array, as `baselineOf` is.
 *
 * @param {import("./types.js").Board} b
 */
const reportIndexes = new WeakMap();
export function reportIndex(b) {
  if (!Array.isArray(b.results)) return {};
  const hit = reportIndexes.get(b.results);
  if (hit) return hit;
  const idx = {};
  b.results.forEach((r) => {
    idx[r.item] = mergeRow(idx[r.item], r, false);
  });
  reportIndexes.set(b.results, idx);
  return idx;
}

/**
 * Group the report's own results by source, at the selected difficulty — the half of each pool the
 * report knows about. Sources the ranking can't or shouldn't show are dropped here; the ones it
 * shows but can't name are recorded in `unknown` for the staleness banner.
 *
 * Rows are folded per item as they arrive (`mergeRow`) and only turned into pool items once the
 * whole report has been read, because a 12.1 report describes one item with three rows and no two
 * of them answer the same question.
 */
function collectScored(b, sp, diffs, selDiff, unknown) {
  const groups = {};
  const keyed = qeIsModern(b) && b.source !== "droptimizer";
  b.results.forEach((r) => {
    const rd = String(diffOf(b, r));
    srcList(b, r).forEach((s) => {
      const instId = s[0],
        encId = s[1],
        vr = s.length > 2 && s[2];
      const info = resolve(instId, encId);
      if (!info) return;
      if (!state.showAll && !info.current) return;
      if (info.type === "raid" && diffs.length && rd !== selDiff) return;
      const key = `${instId}:${encId}`;
      // Only count unknowns that survive the filters — an unidentified source the user can't
      // see isn't a staleness signal worth interrupting them over.
      if (info.unknown)
        unknown[key] =
          info.type === "dungeon"
            ? info.name
            : `${info.instName} · ${info.name}`;
      if (!groups[key])
        groups[key] = {
          key,
          type: info.type,
          name: info.name,
          instName: info.instName || "",
          rows: {},
          items: {},
          special: info.type === "raid" && isSpecial(instId, encId),
        };
      const g = groups[key];
      // A dungeon row's difficulty is the key level the report was run at, which is the one thing
      // that decides what a roll there pays. Only a 12.1 QE report says it: before that the field
      // indexed a different list entirely, and a Droptimizer never carried a key at all.
      if (keyed && info.type === "dungeon" && g.keyLevel == null) {
        const k = Number(rd);
        if (Number.isInteger(k)) g.keyLevel = k;
      }
      g.rows[r.item] = mergeRow(g.rows[r.item], r, vr);
    });
  });
  Object.values(groups).forEach((g) => {
    Object.keys(g.rows).forEach((id) => {
      g.items[id] = poolItem(id, QE_DATA.items[id] || {}, sp, g.rows[id]);
    });
  });
  return groups;
}

/**
 * Fill each group out to the boss's whole loot table.
 *
 * A report only scores what it evaluated, but a bonus roll draws from everything that boss can hand
 * you — so the rest belongs in the pool at zero value. Leaving them out was the other half of the EV
 * error: it shrinks the denominator, flattering every encounter the report is thin on. They render
 * as fillers, folded away behind the "no upgrade" toggle.
 */
function fillTable(groups, sp) {
  Object.keys(groups).forEach((key) => {
    const g = groups[key];
    itemsAt(key).forEach((id) => {
      if (g.items[id]) return;
      const meta = QE_DATA.items[id];
      const src = meta.s.find((x) => `${x[0]}:${x[1]}` === key) || [];
      g.items[id] = poolItem(id, meta, sp, { score: 0, lvl: 0, vr: src[2] });
    });
  });
}

/**
 * Give a tier token the value of the tier piece it is a voucher for.
 *
 * The report never scores the token — no tool does, because a token has no stats — and it scores at
 * most one of the pieces the token contains, since it only ever sims the character's own class. So
 * the best-scoring candidate is both the right answer and the tie-break: where two candidates
 * survive eligibility, only one of them is in the report at all.
 *
 * The item level is carried across too. A token's own is meaningless, and the piece's is what the
 * score was simmed at.
 *
 * @param {import("./types.js").PoolItem} it  A pool item with `gives` set.
 * @param {Record<number, any>} idx  From `reportIndex`.
 */
function applyToken(it, idx) {
  let best = null;
  it.gives.forEach((id) => {
    const r = idx[id];
    if (r && (!best || r.score > best.r.score)) best = { id, r };
  });
  it.givesId = best && best.r.score > 0 ? best.id : it.gives[0];
  it.givesName = QE_DATA.items[it.givesId]?.n || "";
  if (best && best.r.score > 0) {
    it.score = best.r.score;
    it.scoreLvl = best.r.scoreLvl;
  }
}

/**
 * The item level this encounter's *scores* belong to, which is not always the one a roll pays.
 *
 * A 12.1 QE report sims the bonus roll as QE's own "Upgraded Bonus Rolls" panel does: the payout
 * taken to the top of its track, crests spent. So a Heroic boss's scores are ilvl 334 while the
 * roll itself hands the item over at 318, and a card that prints 318 beside an 11,053 HPS gain is
 * describing two different items. One number covers the whole card because the top of a track is a
 * property of the payout rather than of the item — every `bonus` row from a source carries the same
 * level — which is also what lets a filler the report never evaluated be shown at it.
 *
 * The max rather than the first seen, so the last two Mythic bosses (ilvl 344, three steps past
 * Myth 6/6) can't be quoted at a lower level by an item that happens to sort first.
 *
 * @param {import("./types.js").PoolItem[]} items
 * @returns {number|null} Null where nothing in the pool was scored at a known level.
 */
function scoreIlvlOf(items) {
  return items.reduce((m, it) => Math.max(m, it.scoreLvl || 0), 0) || null;
}

/**
 * Which of the character's high watermarks an item's upgrades are discounted by — an index into a
 * `/simc`'s `slot_high_watermarks` — or null where the app can't name one: a one-hander (see
 * `WATERMARK_SLOT` for why those are left out), or an item the database has no slot for.
 *
 * A tier token has no slot of its own; it is spent on a piece, and the piece's slot is the one that
 * climbs. All four class versions of a token are for the same slot, so any of them will do.
 *
 * @param {number} id
 * @returns {number|null}
 */
export function markSlotOf(id) {
  const m = QE_DATA.items[id];
  if (!m) return null;
  const iv = m.iv ?? (m.ct?.length ? QE_DATA.items[m.ct[0]]?.iv : undefined);
  const s = WATERMARK_SLOT[iv];
  return s == null ? null : s;
}

/**
 * The slots a roll here can land in, as watermark indices, once each.
 *
 * Every item still in the pool that this loot spec can be handed counts, filler included: a filler
 * item unlocks its slot's discount exactly as surely as an upgrade does, which is why the crest figure
 * never varies *between* items — only between the slots they fill. Rolled items are gone and can't
 * land. A slot the app can't name is carried as a single null, so the figure can say it assumed one.
 *
 * @param {import("./types.js").PoolItem[]} items  With their states settled.
 * @returns {(number|null)[]}
 */
function poolSlots(items) {
  const out = new Set();
  items.forEach((it) => {
    if (it.elig === false || it.state === "rolled") return;
    out.add(markSlotOf(it.givesId || it.id));
  });
  return [...out];
}

/**
 * Price one grouped encounter: settle what a roll here pays out, decide each item's state against
 * it, then hand the pool to `priceOf`.
 */
function priceGroup(b, g, selDiff, ownedMap, sp, takeId) {
  // What a roll here hands you, which is not always what the boss drops. Same for every item in
  // the row: an upgrade track step is one item level, whichever item lands on it. For a dungeon the
  // key level is the difficulty, and `collectScored` picked it off the report's own rows.
  const diff = diffKey(b, selDiff);
  const reward = rollReward(g.type, diff, g.keyLevel);
  const idx = reportIndex(b);
  const items = Object.values(g.items);
  // The token carries the piece's value, because rolling the token *is* getting the piece. Left at
  // zero it would sit in the pool as filler — and on a tier boss it is routinely the best thing on
  // the table, so the encounter would be understated by its single largest item. Done in its own
  // pass because it rewrites `scoreLvl`, and the next line reads every item's.
  items.forEach((it) => {
    if (it.gives) applyToken(it, idx);
  });
  // One level for the whole pool, settled before any item's state is, because a dupe is judged
  // against it. It's a property of the payout rather than of the item — see `scoreIlvlOf` — which
  // is what lets a filler the report never scored be judged against it alongside everything else.
  const scoreIlvl = scoreIlvlOf(items);
  const top = rollScored(b) ? scoreIlvl : null;
  items.forEach((it) => {
    const ov = b.overlay[`${g.key}:${it.id}`];
    // A tier token is never itself held; the piece it becomes is. Holding that piece at the top of
    // the roll's track makes the token as much a dupe as holding the item would.
    const held = ownedMap[it.givesId || it.id] || null;
    it.ownedIlvl = held ? held.ilvl : null;
    it.ownedStep = held ? held.step : null;
    it.ownedMaybe = held ? held.maybe : null;
    // A copy you already hold only makes the roll redundant if it's at least as good as what the
    // roll would hand you — and in a season that promotes rewards to a vault track, that is not
    // the drop. Owning the Heroic version of an item doesn't dupe a roll that pays out on the
    // Myth track, nor one that pays out lower on that track and climbs past it (`rollTopFor`).
    it.rollIlvl = rollIlvlFor(reward, it.lvl);
    it.rollTopIlvl = rollTopFor(it.rollIlvl, top);
    it.dupe = isDupe(it.ownedIlvl, it.rollTopIlvl);
    it.state =
      ov === "rolled" || ov === "own"
        ? ov
        : takeId === it.id || it.dupe
          ? "own"
          : "want";
  });
  items.sort((a, c) => c.score - a.score || a.name.localeCompare(c.name));

  // Token cost follows the season unless the user overrode this encounter. The per-board
  // tokenRaid/tokenDungeon fields older saves carry were never user-editable, so they're ignored.
  const cost =
    b.tokenOverride[g.key] ||
    (g.type === "raid" ? SEASON.tokenRaid : SEASON.tokenDungeon) ||
    1;
  const p = priceOf(items, cost);
  return {
    g,
    items,
    cost,
    diff,
    reward,
    scoreIlvl,
    slots: poolSlots(items),
    remaining: p.remaining,
    num: p.num,
    ev: p.ev,
    nWant: p.inPool.filter((i) => i.state === "want" && i.score > 0).length,
    nBlocked: items.length - p.inPool.length,
    alts: altSpecs(items, sp, cost, p.ev),
  };
}

/**
 * Build the ranked list of rollable sources for a board at its selected difficulty.
 * Returns { rows, selDiff, diffs, unknown } where each row carries its items, pool size, and EV,
 * and `unknown` names the visible sources the encounter database couldn't identify.
 * @param {import("./types.js").Board} b
 * @returns {{ rows: import("./types.js").Row[], selDiff: string, diffs: string[],
 *   keyLevel: number|null, unknown: string[] }}
 */
/**
 * The best copy of each item the character is known to hold: its item level, and the upgrade-track
 * step its bonus ids name where either source sent them.
 *
 * Two sources, and they aren't rivals. A QE report ships the gear that was equipped when it ran, so
 * a healer who pastes nothing but a report link still gets dupe detection. A `/simc` export covers
 * bags as well as equipped and can be refreshed without re-simming, so it's usually the fuller and
 * fresher of the two. Merged by taking the higher item level, which is the question actually being
 * asked: is the copy you hold already as good as what a roll here would hand you?
 *
 * The step is read off bonus ids where either source sent them. Without them the level decides only
 * where it can: 334 is Myth 6/6 and nothing else, but 321 is Hero 6/6 *or* Myth 2/6, and which it is
 * decides whether a Myth 1/6 at 318 is a downgrade or the better item. So an overlap level carries
 * both candidates (`maybe`) rather than landing on a plausible-looking wrong one. Every item this is
 * asked about comes out of a raid or dungeon pool or a vault, so "on no track at all" — crafted gear
 * — isn't a reading the level has to allow for.
 *
 * @param {import("./types.js").Board} b
 * @returns {Record<number, {ilvl: number, step: string|null, maybe: string[]|null}>}
 */
function ownedGear(b) {
  const simc = simcOf(b);
  /** @type {Record<number, {ilvl: number, bonus: number[]|null}>} */
  const best = {};
  const add = (levels, bonus) =>
    Object.keys(levels || {}).forEach((id) => {
      const lvl = levels[id],
        ids = bonus?.[id]?.length ? bonus[id] : null,
        cur = best[id];
      // A tie goes to whichever copy says what track it's on.
      if (!cur || lvl > cur.ilvl || (lvl === cur.ilvl && !cur.bonus && ids))
        best[id] = { ilvl: lvl, bonus: ids };
    });
  add(b.equipped, b.equippedBonus);
  add(simc?.owned, simc?.ownedBonus);
  /** @type {Record<number, {ilvl: number, step: string|null, maybe: string[]|null}>} */
  const out = {};
  Object.keys(best).forEach((id) => {
    const { ilvl, bonus } = best[id];
    if (bonus) {
      out[id] = {
        ilvl,
        step: trackStep(SEASON, bonus, ilvl)?.label || null,
        maybe: null,
      };
      return;
    }
    const could = stepsAt(SEASON, ilvl);
    out[id] = {
      ilvl,
      step: could.length === 1 ? could[0] : null,
      maybe: could.length > 1 ? could : null,
    };
  });
  return out;
}

/**
 * The crests a roll saves in a slot whose high watermark is `mark`.
 *
 * The whole model, in one line of arithmetic (`climbCost` carries it). An item arrives at the
 * payout's step, and without the roll you'd have climbed there from where the boss drops it
 * (`crestFrom`). Every step of that climb costs `crestPerStep` — *except* steps landing at or below
 * the slot's watermark, which Blizzard discounts to nothing (`highWatermarkDiscounts`, `scaling: 0`).
 *
 * The watermark is an item level, not a track position, and that is what makes this interesting:
 * Midnight's tracks overlap by two steps, so Hero 6/6 and Myth 2/6 are both ilvl 321.
 *
 * Which is why the mark is clamped up to `crestFreeTo` rather than taken as given. A slot below that
 * line would arithmetically pay all five steps — 100 crests — but reaching the line costs only *Hero*
 * crests, which M+ hands out freely, so nobody should ever pay Myth crests for that step. Pricing the
 * roll at 100 would be crediting the token with rescuing a mistake the player shouldn't make, and it
 * would put a number on screen above the one every guide quotes. So this tops out at the guides'
 * figure and only ever falls: `crestFreeTo` is the floor, the payout's own step is the ceiling.
 *
 * The Hero crests that floor assumes are deliberately not priced. They're cheap and farmable on
 * demand, and a second currency on an encounter card is noise against the decision being made.
 *
 * A null mark means "unknown", which lands on the same clamp and so returns the maximum.
 *
 * It is a saving against the *drop*, which is the comparison between encounters it exists for. It is
 * not a term of the Great Vault trade: the item there isn't a drop you'd otherwise have climbed, and
 * what the vault option costs to finish is priced on the option itself (`vaultChoice`).
 *
 * @param {import("./season.js").Reward|null|undefined} reward
 * @param {number|null} [mark]  The slot's high watermark, or null for unknown.
 * @returns {number|null} Crests saved, or null where the payout has no step table to reason over.
 */
export function crestSavingAt(reward, mark) {
  if (!reward?.crestSteps || !reward.crestPerStep) return null;
  if (reward.crestFrom == null) return null;
  const steps = reward.crestSteps;
  return climbCost(
    {
      steps,
      perStep: reward.crestPerStep,
      freeTo: reward.crestFreeTo == null ? -Infinity : reward.crestFreeTo,
    },
    reward.crestFrom,
    steps[steps.length - 1],
    mark,
  );
}

/**
 * Crests to take an item from `from` up its own track to `to`, in a slot whose high watermark is
 * `mark` — the one piece of arithmetic every crest figure on the page comes through, whether it is
 * called a saving (a roll arriving further up than the drop would) or a cost (a vault option that
 * arrives short of the top).
 *
 * A step is paid for if it lands above both the slot's mark and the track's free line. The free line
 * is the top of the track below, which the two-step overlap makes this track's second step: capping
 * a slot on the track below costs that track's crests, never this one's, so the step it covers is
 * never charged here. `crestSavingAt` explains why that clamp is policy and not a guess.
 *
 * @param {{steps: number[], perStep: number, freeTo?: number}} track  A season `Track`, or anything
 *   shaped like one. `freeTo` overrides the free line; it defaults to the track's second step.
 * @param {number} from  Item level the item arrives at.
 * @param {number} to    Item level it is taken to.
 * @param {number|null} [mark]  The slot's high watermark, or null for unknown.
 * @returns {number}
 */
export function climbCost(track, from, to, mark) {
  const free = Math.max(
    mark == null ? -Infinity : mark,
    track.freeTo ?? track.steps[1] ?? -Infinity,
  );
  return (
    track.steps.filter((s) => s > from && s <= to && s > free).length *
    track.perStep
  );
}

/**
 * A crest figure over the slots it could apply to: a range, collapsing to a single number where they
 * agree. Null where there is nothing to compute from — no linked `/simc`, or one too old to carry the
 * marks.
 *
 * `slots` are watermark indices (`poolSlots`); a null among them is a slot the app can't name, and
 * any slot the line didn't report is unknown too. Both are priced at a null mark — the season's
 * assumption — and counted in `assumed`, so the copy never calls a partly assumed figure computed.
 * Without `slots` it is every slot the character has, which is the character-wide question the
 * reward pane asks.
 *
 * @param {import("./types.js").Board} b
 * @param {(mark: number|null) => number|null} at  The figure for one slot's mark.
 * @param {(number|null)[]} [slots]
 * @returns {{min: number, max: number, flat: boolean, slots: number, assumed: number}|null}
 */
function overSlots(b, at, slots) {
  const marks = simcOf(b)?.watermarks;
  if (!Array.isArray(marks) || !marks.length) return null;
  const read = slots
    ? slots.map((s) => (s == null ? null : (marks[s] ?? null)))
    : marks.filter((m) => m != null);
  if (!read.length) return null;
  const each = read.map(at);
  if (each.some((v) => v == null)) return null;
  const min = Math.min(...each),
    max = Math.max(...each);
  return {
    min,
    max,
    flat: min === max,
    slots: read.length,
    assumed: read.filter((m) => m == null).length,
  };
}

/**
 * What a roll here saves this character, across the slots it could land in.
 *
 * A roll hands you one item in one slot, and which slot is unknowable until it lands — so the honest
 * answer is a range over the slots, collapsing to a single figure when they all agree. Pass the row's
 * `slots` and it is the slots this pool can actually fill; a boss whose only live item is a pair of
 * legs saves exactly what your legs slot does. Early in a season the slots usually agree anyway,
 * because nothing is capped anywhere.
 *
 * The indices are Blizzard's `Enum.ItemRedundancySlot` (see `WATERMARK_SLOT`). They were once read as
 * SimC's slot list, which never fitted real gear — marks landed below items held in the same slot —
 * and the figure stayed a range over the whole character rather than attribute a mark on a guess.
 *
 * @param {import("./types.js").Board} b
 * @param {import("./season.js").Reward|null|undefined} reward
 * @param {(number|null)[]} [slots]  Watermark indices a roll here can land in; see `poolSlots`.
 * @returns {{min: number, max: number, flat: boolean, slots: number, assumed: number}|null} null when
 *   there's nothing to compute from, or a payout with no step table or nothing to save.
 */
export function crestSavingRange(b, reward, slots) {
  if (!reward?.crests) return null;
  return overSlots(b, (m) => crestSavingAt(reward, m), slots);
}

/**
 * The spec a bonus roll would actually award against, best source first.
 *
 * 1. What the user picked in the loot-spec dropdown. An explicit choice outranks everything.
 * 2. What the game says, via `loot_spec` in a linked `/simc`. This is the real answer, and it is
 *    routinely not the spec the report was run as — a Mistweaver who loots as Windwalker to dodge
 *    intellect trinkets is the standard case, and the report has no idea.
 * 3. The report's own spec, which is only a guess at the loot spec, but the only one left.
 *
 * @param {import("./types.js").Board} b
 * @returns {string|null} spec id, or null when nothing resolves.
 */
export function activeLootSpec(b) {
  return b.lootSpec || simcLootSpec(b) || specId(b.spec);
}

/**
 * The loot spec a linked `/simc` reports, resolved to a spec id, or null.
 *
 * Resolved *within the report's own class* rather than globally, which is the only way it resolves
 * at all for the many spec names two classes share — a `/simc` writes `loot_spec=holy`, and on its
 * own that is a Priest or a Paladin. Confining the lookup to the class both disambiguates it and
 * makes it impossible for a stale `/simc` from another character to re-point the pool.
 *
 * @param {import("./types.js").Board} b
 * @returns {string|null}
 */
export function simcLootSpec(b) {
  const raw = simcOf(b)?.lootSpec;
  return raw ? specIdInClass(raw, specId(b.spec)) : null;
}

export function buildGroups(b) {
  const sp = activeLootSpec(b);
  const diffs = raidDiffs(b);
  const selDiff =
    b.raidDiff != null && diffs.includes(String(b.raidDiff))
      ? String(b.raidDiff)
      : diffs[0];
  const unknown = {};

  const groups = collectScored(b, sp, diffs, selDiff, unknown);
  fillTable(groups, sp);

  const take = vaultTakeOf(b);
  const owned = ownedGear(b);
  const rows = Object.values(groups).map((g) =>
    priceGroup(b, g, selDiff, owned, sp, take),
  );
  rows.sort(
    (a, c) => c.ev - a.ev || c.num - a.num || a.g.name.localeCompare(c.g.name),
  );
  // One report is run at one key level, so any dungeon group's is the board's. Surfaced here rather
  // than dug out of the rows by the caller: the reward pane wants it to mark the rung the page is
  // actually pricing, and that pane never sees a row.
  const keyed = Object.values(groups).find((g) => g.keyLevel != null);
  return {
    rows,
    selDiff,
    diffs,
    keyLevel: keyed ? keyed.keyLevel : null,
    unknown: Object.values(unknown),
  };
}

/**
 * What state the linked `/simc`'s Great Vault block is in — and in particular whether it is still
 * this week's.
 *
 * A vault is three options that appear at the weekly reset and are gone at the next one. The rest of
 * a `/simc` paste doesn't work that way: the gear you own and the rolls you've logged stay true
 * until a newer paste replaces them, and a month-old export is still worth reading for both. So the
 * expiry is scoped to the vault alone rather than to the record holding it.
 *
 * A paste with no `at` is treated as expired. Those predate the app dating them at all, so the honest
 * reading is "recorded at an unknown time", and an unknown time is not evidence of this week. The
 * cost of being wrong is a prompt to re-paste; the cost of the opposite is pricing this week's one
 * irreversible decision against a vault that closed weeks ago.
 *
 * @param {import("./types.js").Board} b
 * @param {Date} [now]
 * @returns {{at: Date|null, reset: Date|null, stale: boolean}|null} null when there is no vault to
 *   have a state — no linked `/simc`, or one whose export held no Weekly Reward Choices block.
 */
export function vaultStatus(b, now) {
  const simc = simcOf(b);
  if (!simc?.vault?.length) return null;
  const reset = lastReset(SEASON, now);
  const t = simc.at ? Date.parse(simc.at) : NaN;
  const at = Number.isFinite(t) ? new Date(t) : null;
  // No calendar to measure against means no claim either way — a season nobody has dated can't be
  // told that its vault expired.
  return { at, reset, stale: !!reset && (!at || t < reset.getTime()) };
}

/**
 * The vault pick the ranking should honour, which is none once the vault it was picked from has
 * expired. Marking an item Own is a real edit to a pool, and an expired vault must not be making it.
 *
 * @param {import("./types.js").Board} b
 * @param {Date} [now]
 */
export function vaultTakeOf(b, now) {
  const st = vaultStatus(b, now);
  return st?.stale ? null : b.vaultTake;
}

/**
 * Every item level a report priced an item at, best score first at each, low to high.
 *
 * The pools want one row per item and `mergeRow` gives them that. A vault option wants the opposite:
 * a 12.1 report scores each item three times — the drop, the drop capped, and the bonus payout
 * capped — and a vault slot arrives at whichever level the vault decided, which is frequently none
 * of the three. The curve through those points is the only evidence there is about what the item is
 * worth at the level actually on offer, so it has to survive as a curve.
 *
 * @param {import("./types.js").Board} b
 * @param {number} id
 * @returns {[number, number][]} `[itemLevel, score]`, ascending, one entry per level.
 */
function scoreCurve(b, id) {
  const at = new Map();
  b.results.forEach((r) => {
    if (r.item !== id) return;
    const lvl = r.level || 0,
      sc = scoreOf(r);
    if (!lvl) return;
    if (!at.has(lvl) || at.get(lvl) < sc) at.set(lvl, sc);
  });
  return [...at.entries()].sort((x, y) => x[0] - y[0]);
}

/**
 * What a vault option is worth *at the item level the vault is handing it over at*.
 *
 * The bug this exists to kill: ranking vault options by their `bonus` row compares them at a level
 * three of five slots don't arrive at. A Mythic raid slot pays Myth 6/6 and a M+ slot pays Myth 1/6,
 * five steps apart, and the `bonus` row is simmed at the cap for both — so a dungeon option can beat
 * a raid option on a number neither the vault nor the player will ever see. Observed at 6,837 against
 * 5,085 where the honest comparison was 3,391 against 5,085: the wrong item, by 1,700.
 *
 * Three tiers, in descending order of how much they claim:
 *
 *   exact    the report scored this item at this very level. Nothing is computed; the right row is
 *            simply picked instead of the wrong one. Every capped slot lands here.
 *   between  the offered level falls between two levels the report scored, so the value is read off
 *            the line joining them. This is interpolation and it is the only tier that invents
 *            anything — but it invents it *between* two measurements ten item levels apart, where a
 *            quadratic through all three points differs from the chord by well under a percent.
 *   outside  the offered level sits beyond every level the report scored. That is extrapolation, and
 *            it is refused: the option carries no value and cannot become the item the banner argues
 *            against. A raid slot awarded below its own Mythic drop level lands here.
 *
 * The README's "interpolating one would be inventing it" is narrowed by this, not overruled — the
 * claim it was really guarding against is a number pulled from outside the report's own range, and
 * that is exactly what `outside` still refuses.
 *
 * The capped figure isn't wrong, only unpaid for: 6,837 is what those breeches become for 80 Myth
 * crests. It comes back as the option's finished reading, with that price beside it, rather than
 * standing in for the item as offered — see `finishedReading`.
 *
 * @param {[number, number][]} curve  From `scoreCurve`, ascending.
 * @param {number} ilvl  The level the vault is offering.
 * @returns {{score: number, at: "exact"|"between"|"outside", from: number, to: number}|null}
 *   null where the report never scored the item at all.
 */
function valueAt(curve, ilvl) {
  if (!curve.length) return null;
  const exact = curve.find(([l]) => l === ilvl);
  if (exact) return { score: exact[1], at: "exact", from: ilvl, to: ilvl };
  for (let i = 0; i < curve.length - 1; i++) {
    const [lo, slo] = curve[i],
      [hi, shi] = curve[i + 1];
    if (ilvl > lo && ilvl < hi)
      return {
        score: slo + ((ilvl - lo) / (hi - lo)) * (shi - slo),
        at: "between",
        from: lo,
        to: hi,
      };
  }
  return {
    score: 0,
    at: "outside",
    from: curve[0][0],
    to: curve[curve.length - 1][0],
  };
}

/**
 * What finishing a vault option takes: its value at the top of its own track, and the crests that
 * climb costs in the slot it would go in.
 *
 * The option's as-it-comes value (`valueAt` at the level offered) is the honest number for *this
 * week*, and it was the fix for quoting every option at a cap most slots never reach. But it is only
 * half of what the option is. A Heroic or +10 slot hands an item over at Myth 1/6 with five steps
 * still to climb, and a 318 copy of a ring you already wear at 321 is worth nothing as it comes and
 * thousands once finished. Quoting only the first number made that item vanish from the panel; quoting
 * only the second was the old bug. So both are kept, and the second carries its price.
 *
 * The price is read off the item's own slot. Its track comes from the option's bonus ids
 * (`trackStep`), and the climb is `climbCost` over that track against the slot's high watermark, so
 * a ring whose slot is already at 321 pays four steps, not five. With no `/simc` marks, or a slot the
 * app can't name, the mark is unknown and the figure is the season's assumption — the most it costs.
 *
 * @param {import("./types.js").Board} b
 * @param {{id: number, ilvl: number, bonus?: number[]}} v
 * @param {[number, number][]} curve  From `scoreCurve`.
 */
function finishedReading(b, v, curve) {
  const step = trackStep(SEASON, v.bonus, v.ilvl);
  if (!step || step.top <= v.ilvl) return { step, top: null };
  const val = valueAt(curve, step.top);
  const simc = simcOf(b);
  const slot = markSlotOf(v.id);
  const mark =
    Array.isArray(simc?.watermarks) && slot != null
      ? (simc.watermarks[slot] ?? null)
      : null;
  const have = simc?.currencies?.[step.track.currency];
  const climb = step.track.steps.filter((s) => s > v.ilvl && s <= step.top);
  return {
    step,
    top: {
      ilvl: step.top,
      label: step.topLabel,
      score: val?.score || 0,
      at: val?.at || null,
      from: val?.from || 0,
      to: val?.to || 0,
      crests: climbCost(step.track, v.ilvl, step.top, mark),
      kind: step.track.name,
      // The slot's own mark where it was read; null means `crests` is the assumption, not a reading.
      slot,
      mark,
      // How many steps the climb has, and how many of them the slot's mark already covers — the
      // difference between this figure and a naive five-step count, stated rather than implied.
      steps: climb.length,
      covered: mark == null ? 0 : climb.filter((s) => s <= mark).length,
      // A known mark below the track's free line: the figure then leans on the same assumption as an
      // unknown one — that the slot is capped on the track below first — and has to say so.
      clamped:
        mark != null && climb.some((s) => s > mark && s <= step.track.steps[1]),
      // Crests of that kind held at the paste, where the paste says. Context for the figure, never an
      // input to it: a balance is spent on whatever the player chooses, and this app doesn't choose.
      have: have == null ? null : have,
    },
  };
}

/**
 * What the top roll's payout still needs to reach the value it is priced at.
 *
 * Nothing, for a payout that arrives at the top of its track — a Mythic boss's. A Heroic boss or a
 * +10 dungeon hands its item over at Myth 1/6 while a 12.1 report prices it at 6/6, so that roll's
 * figure assumes the same climb a vault option's finished reading does, and a banner that charged
 * the option for it and not the roll would be comparing a finished item with an unfinished one.
 * Where the roll lands is unknown, so it is a range over the slots its pool can fill.
 *
 * Only where the report makes that claim: a Droptimizer sims the drop and has climbed nothing.
 *
 * @param {import("./types.js").Board} b
 * @param {import("./types.js").Row|null} row
 * @returns {{min: number, max: number, known: boolean, kind: string}|null} null where nothing is left
 *   to pay.
 */
function rollFinish(b, row) {
  if (!row || !rollScored(b)) return null;
  const rw = row.reward;
  const track = SEASON.tracks?.[rw?.crestKind];
  if (!track || !rw.ilvl || !row.scoreIlvl || row.scoreIlvl <= rw.ilvl)
    return null;
  const at = (m) => climbCost(track, rw.ilvl, row.scoreIlvl, m);
  const rng = overSlots(b, at, row.slots);
  const max = rng ? rng.max : at(null);
  if (!max) return null;
  return {
    min: rng ? rng.min : max,
    max,
    known: !!rng && !rng.assumed,
    kind: track.name,
  };
}

/**
 * The crest the verdict weighs: the season's top track's, the one a player can't farm their way out
 * of. The tracks below it are paid in crests M+ hands out freely, which the app deliberately doesn't
 * price (see `crestSavingAt`) — they're still quoted wherever they're spent, just never argued over.
 */
function scarceCrest() {
  const t = Object.values(SEASON.tracks || {}).sort(
    (x, y) => y.steps[0] - x.steps[0],
  )[0];
  return t ? t.name : null;
}

/**
 * The week's actual trade: one guaranteed item out of the Great Vault, or the token that buys one
 * roll. Where the season pays the token out of a vault slot, these are not two decisions but one,
 * and the ranking on its own can't answer it — it prices rolls against each other, never against
 * the item already sitting in front of you.
 *
 * The roll side is priced with nothing taken from the vault, because that's the branch being
 * costed: you can't both take an item and spend the token it would have been. `buildGroups` is run
 * again for that rather than reusing the board's current `vaultTake`, which is the *other* branch.
 *
 * Item values come from the whole report, not just the visible pools — a vault option filtered out
 * of the ranking (older content, another difficulty) is still an item you can take this week.
 *
 * Every option is read twice: as it comes (`keep` is the best of those) and finished at the top of
 * its track, for the crests that costs (`finishedReading`; `stretch` is the finished reading worth
 * raising). The roll is always finished, since that is what the report priced, and carries whatever
 * crests it still needs (`rollFinish`). The verdict then never converts crests into score, because
 * no rate between them exists that doesn't depend on what else you'd spend them on:
 *
 *   free   the best of the three at the smallest crest outlay — what you'd pick if crests were off.
 *   best   the best of the three on value alone.
 *
 * Where those are the same thing, that is the answer and the crests don't enter into it — "roll" or
 * "keep". Where both are items, it's "keep" either way and which item turns on the crests. Otherwise
 * it's "crests": the token or the item really does turn on what those crests are worth to you, and
 * the banner says so with both numbers rather than pretending to a rate.
 *
 * @param {import("./types.js").Board} b
 * @returns {{options: any[], keep: any, stretch: any, item: any, top: import("./types.js").Row|null,
 *   perRoll: number, rollFinish: {min: number, max: number, known: boolean, kind: string}|null,
 *   free: any, best: any, verdict: "keep"|"roll"|"crests",
 *   drag: {amount: number, name: string, isTop: boolean}|null}|null}
 *   null when no vault has been imported.
 */
export function vaultChoice(b) {
  const simc = simcOf(b);
  if (!simc?.vault?.length) return null;
  // An expired vault has no trade in it: the options are gone from the game, so there is nothing to
  // weigh a roll against. The panel says so rather than the app quietly ranking last week's items.
  const st = vaultStatus(b);
  if (st?.stale) return null;

  // Each option priced at the level its own vault slot is offering, which is the only level any of
  // this is a decision about *this week*. Not `mergeRow` — that keeps the bonus row alone, which is
  // right for a roll and wrong here for every slot the vault doesn't hand over capped. See `valueAt`.
  // What it becomes once finished is read separately, with its price; see `finishedReading`.
  const held = ownedGear(b);
  const options = simc.vault.map((v) => {
    const curve = scoreCurve(b, v.id);
    const val = valueAt(curve, v.ilvl);
    const fin = finishedReading(b, v, curve);
    return {
      id: v.id,
      name: QE_DATA.items[v.id]?.n || v.name,
      ilvl: v.ilvl,
      step: fin.step ? fin.step.label : null,
      score: val?.score || 0,
      // How much the number above is claiming: read off, interpolated, or refused. Null where the
      // report never evaluated the item — distinguished from a genuine zero, since "worth 0" about
      // an item nobody simmed is a claim we haven't earned.
      at: val?.at || null,
      from: val?.from || 0,
      to: val?.to || 0,
      scored: val != null,
      // A copy already held, which is usually why a zero is a zero: the report sims each item against
      // the gear it was run in, and a 318 of a ring worn at 321 is a downgrade as it comes. Its track
      // is what says whether the 318 is nonetheless the better item — Myth 1/6 over Hero 6/6.
      held: held[v.id]?.ilvl || null,
      heldStep: held[v.id]?.step || null,
      heldMaybe: held[v.id]?.maybe || null,
      top: fin.top,
    };
  });
  const priced = (r) => !!r && !!r.at && r.at !== "outside";
  // An option we can't place can't be the thing the banner argues against — it would be arguing
  // against a number that isn't there. Only where nothing places at all does the best of them stand
  // in, so the panel still has something to head itself with.
  const placeable = options.filter(priced);
  // Ties go to the option worth more finished: a vault of four zeroes as they come — a real week-7
  // one — should be headed by the one that becomes something, not by whichever sorted first.
  const later = (o) => (priced(o.top) ? o.top.score : o.score);
  const keep = (placeable.length ? placeable : options)
    .slice()
    .sort((a, c) => c.score - a.score || later(c) - later(a))[0];
  // The finished reading worth raising: one the report actually priced, that finishing improves,
  // and that beats every option as it comes — otherwise it changes nothing the banner says.
  const stretch =
    options
      .filter(
        (o) =>
          priced(o.top) &&
          o.top.score > o.score &&
          (!priced(keep) || o.top.score > keep.score),
      )
      .sort((a, c) => c.top.score - a.top.score)[0] || null;

  const rows = buildGroups(Object.assign({}, b, { vaultTake: null })).rows;
  const top = rows.find((r) => r.ev > 0) || null;
  // The expected score of the one roll you'd actually make. Not `row.ev`, which is per *token* —
  // against a single vault slot the question is what one roll returns, with its price alongside.
  const perRoll = top ? top.num / top.remaining : 0;
  const fin = rollFinish(b, top);

  const scarce = scarceCrest();
  const cost = (kind, n) => (kind === scarce ? n : 0);
  // Items first, so an exact tie goes to the item: a guarantee beats an expectation of the same size.
  const cands = [];
  if (priced(keep))
    cands.push({ kind: "item", o: keep, value: keep.score, crests: 0 });
  if (stretch)
    cands.push({
      kind: "item",
      o: stretch,
      finished: true,
      value: stretch.top.score,
      crests: cost(stretch.top.kind, stretch.top.crests),
    });
  if (top)
    cands.push({
      kind: "roll",
      value: perRoll,
      crests: fin ? cost(fin.kind, fin.max) : 0,
    });
  const pick = (cs) =>
    cs.reduce(
      (a, c) =>
        !a || c.value > a.value || (c.value === a.value && c.crests < a.crests)
          ? c
          : a,
      null,
    );
  const least = Math.min(...cands.map((c) => c.crests));
  const free = pick(cands.filter((c) => c.crests === least));
  const best = pick(cands);
  const verdict = !best
    ? "keep"
    : best === free
      ? best.kind === "roll"
        ? "roll"
        : "keep"
      : best.kind === "item" && free.kind === "item"
        ? "keep"
        : "crests";
  // The item the banner is weighing — the one to charge for the pool it leaves behind.
  const side = [best, free].find((c) => c?.kind === "item");
  const item = side ? side.o : keep;

  return {
    options,
    keep,
    stretch,
    item,
    top,
    perRoll,
    rollFinish: fin,
    free,
    best,
    verdict,
    drag: dragOf(rows, item),
  };
}

/**
 * What taking the vault item costs every roll you make on its encounter afterwards.
 *
 * The two branches aren't symmetrical the way a one-week comparison implies. A roll *removes* an
 * item from its pool for good, so every later roll there improves. Taking the item from your vault
 * does the reverse: the item stays in the pool, now worth nothing to you and still counted, so
 * every later roll on that encounter is permanently worse. Dropping the item out of the numerator
 * costs the encounter `score / remaining` per roll from then on.
 *
 * Reported, never netted out: the size of it depends on how many times you'd roll that encounter
 * again, which is a question about the rest of the season that this app doesn't model.
 *
 * @param {import("./types.js").Row[]} rows  Pools priced with nothing taken from the vault.
 * @param {{id: number}} item  The vault option the trade is weighing.
 */
function dragOf(rows, item) {
  let worst = null;
  rows.forEach((r, i) => {
    const it = r.items.find((x) => x.id === item.id);
    // Only an item that currently counts can stop counting. One already Own or Rolled — a dupe, or
    // one you've had before — is doing its damage to the pool either way.
    if (
      !it ||
      it.elig === false ||
      it.state !== "want" ||
      !it.score ||
      r.remaining <= 0
    )
      return;
    const amount = it.score / r.remaining;
    if (!worst || amount > worst.amount)
      worst = { amount, name: r.g.name, isTop: i === 0 };
  });
  return worst;
}

/* ---------- display scaling ----------
   A score means whatever its report meant by it, so every number on screen goes out through here.
   Kept beside the model rather than in a formatting module because the scaling factor is a property
   of the board, which is a model concept.

   The tool decides the unit, because the two measure different things: a Droptimizer sims damage, so
   its scores are DPS whoever ran it, and QE Live is a healing tool, so its scores are HPS. Both can
   also be shown as a percentage of the character's own throughput, which is the comparable figure
   across characters — raw is the default, since it's the one you can weigh against a real number.

   Both conversions are one multiply by a per-board constant, so the EV can be scaled after the fact
   rather than the pool being re-priced. See `baselineOf` for where that constant comes from. */

function facOf(b) {
  if (b.metric !== "pct") return 1;
  const base = baselineOf(b);
  return base > 0 ? 100 / base : 1;
}

/**
 * The character's own throughput, which is what a percentage is a percentage *of*.
 *
 * A Droptimizer states it outright: `sim.players[0].collected_data.dps.mean`, stashed at ingest.
 * A QE report never sends it, but it sends enough to recover it exactly. Every QE result carries
 * both metrics of the same upgrade — `rawDiff`, the HPS gained, and `percDiff`, that same gain as a
 * percentage — and QE computes them from one `baseHPS` fixed for the whole report:
 *
 *     rawDiff = ((newScore - baseScore) / baseScore) * baseHPS     percDiff = the same ratio × 100
 *
 * so baseHPS is `rawDiff / percDiff * 100` from any single result. Summed over all of them instead
 * of taken from one, because both fields are rounded — `rawDiff` to a whole number and `percDiff`
 * to three decimals — and the small items are where that rounding bites hardest.
 *
 * Cached against the results array rather than the board: reloading a report replaces that array,
 * which is exactly when the baseline can change, and a WeakMap needs no invalidation to notice.
 */
const qeBaselines = new WeakMap();
export function baselineOf(b) {
  if (b.source === "droptimizer") return b.baseline || 0;
  if (!Array.isArray(b.results)) return 0;
  const hit = qeBaselines.get(b.results);
  if (hit !== undefined) return hit;

  let raw = 0,
    pct = 0;
  b.results.forEach((r) => {
    if (typeof r.rawDiff !== "number" || typeof r.percDiff !== "number") return;
    if (r.rawDiff <= 0 || r.percDiff <= 0) return; // a zero tells us nothing about the ratio
    raw += r.rawDiff;
    pct += r.percDiff;
  });
  const base = pct > 0 ? (raw / pct) * 100 : 0;
  qeBaselines.set(b.results, base);
  return base;
}

/**
 * Format a number to at most 2 decimals with locale grouping — except where 2 decimals is the whole
 * number.
 *
 * An EV is a score divided by a pool of a dozen items and again by a token cost, so it is already
 * two orders of magnitude below the scores it came from; in percentage mode, where the scores are
 * themselves fractions of a percent, that lands under 0.01 and a flat 2-decimal rounding renders
 * every dungeon on the page as "0". Observed on a real Midnight report: a 578 HPS upgrade is 0.24%
 * of a 242,000 HPS baseline, and one roll's expectation on it 0.02% — with the row below it at
 * "0". So anything under 0.1 keeps two significant figures instead, which is enough to rank by.
 */
export function fmt(n) {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.1)
    return n.toLocaleString(undefined, { maximumSignificantDigits: 2 });
  return (Math.round(n * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Unit a board's raw scores are in: HPS for a healing report, DPS for a damage sim. */
export function rawUnitOf(b) {
  return b.source === "droptimizer" ? "DPS" : "HPS";
}

/** Unit label for a board's scores as currently displayed: "DPS", "% HPS", and so on. */
export function unitOf(b) {
  return (b.metric === "pct" ? "% " : "") + rawUnitOf(b);
}

/** Can this board's scores be shown as a percentage? Only where we have a baseline to divide by. */
export function hasPct(b) {
  return baselineOf(b) > 0;
}

/** Format a raw score in the board's chosen display unit. */
export function dv(b, v) {
  return fmt(v * facOf(b));
}
