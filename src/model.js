// The expected-value model: resolve encounters, group a report's results by source,
// score each pool, and rank sources by EV.
//
//   EV = ( Σ score of items you still "want" ÷ items still in the pool ) ÷ token cost

import {
  QE_DATA,
  QE_RAID_DIFFICULTIES,
  QE_RAID_DIFFICULTIES_LEGACY,
  DIFF_ORDER,
} from "./data.js";
import { SEASON, rollReward, lastReset } from "./season.js";
import { state } from "./store.js";
import { canLoot, specId, classSpecs, specIdInClass } from "./loot.js";

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
      name: "Unknown dungeon " + encId,
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
      name: "Unknown boss " + encId,
      instName: "Unknown raid " + instId,
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
    : (QE_DATA.items[r.item] || {}).s || [];
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
  return isNaN(n) ? 0 : n;
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
  return slider[Number(d)] || "Diff " + d;
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
  const order =
    r.order && r.order.length
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
        const k = s[0] + ":" + s[1];
        (bySource[k] || (bySource[k] = [])).push(id);
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
  return {
    id: Number(id),
    name: meta.n || "Item " + id,
    q: meta.q || 3,
    score: read.score,
    lvl: read.lvl,
    scoreLvl: read.scoreLvl || read.lvl,
    vr: !!read.vr,
    elig: lt.ok,
    why: lt.why || "",
    swap: lt.swap || null,
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
      const key = instId + ":" + encId;
      // Only count unknowns that survive the filters — an unidentified source the user can't
      // see isn't a staleness signal worth interrupting them over.
      if (info.unknown)
        unknown[key] =
          info.type === "dungeon"
            ? info.name
            : info.instName + " · " + info.name;
      const g =
        groups[key] ||
        (groups[key] = {
          key,
          type: info.type,
          name: info.name,
          instName: info.instName || "",
          rows: {},
          items: {},
          special: info.type === "raid" && isSpecial(instId, encId),
        });
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
      const src = meta.s.find((x) => x[0] + ":" + x[1] === key) || [];
      g.items[id] = poolItem(id, meta, sp, { score: 0, lvl: 0, vr: src[2] });
    });
  });
}

/**
 * Price one grouped encounter: settle what a roll here pays out, decide each item's state against
 * it, then hand the pool to `priceOf`.
 */
function priceGroup(b, g, selDiff, ownedMap, sp, takeId) {
  // What a roll here hands you, which is not always what the boss drops. Same for every item in
  // the row: an upgrade track step is one item level, whichever item lands on it. For a dungeon the
  // key level is the difficulty, and `collectScored` picked it off the report's own rows.
  const reward = rollReward(g.type, diffKey(b, selDiff), g.keyLevel);
  const items = Object.values(g.items)
    .map((it) => {
      const ov = b.overlay[g.key + ":" + it.id];
      it.ownedIlvl = ownedMap[it.id] != null ? ownedMap[it.id] : null;
      // A copy you already hold only makes the roll redundant if it's at least as good as what the
      // roll would hand you — and in a season that promotes rewards to a vault track, that is not
      // the drop. Owning the Heroic version of an item doesn't dupe a roll that pays out on the
      // Myth track.
      it.rollIlvl = rollIlvlFor(reward, it.lvl);
      it.dupe = isDupe(it.ownedIlvl, it.rollIlvl);
      it.state =
        ov === "rolled" || ov === "own"
          ? ov
          : takeId === it.id || it.dupe
            ? "own"
            : "want";
      return it;
    })
    .sort((a, c) => c.score - a.score || a.name.localeCompare(c.name));

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
    reward,
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
 * The best copy of each item the character is known to hold, as `{ itemId: ilvl }`.
 *
 * Two sources, and they aren't rivals. A QE report ships the gear that was equipped when it ran, so
 * a healer who pastes nothing but a report link still gets dupe detection. A `/simc` export covers
 * bags as well as equipped and can be refreshed without re-simming, so it's usually the fuller and
 * fresher of the two. Merged by taking the higher item level, which is the question actually being
 * asked: is the copy you hold already as good as what a roll here would hand you?
 *
 * @param {import("./types.js").Board} b
 * @returns {Record<number, number>}
 */
function ownedGear(b) {
  const fromSimc = (state.simc[b.key] || {}).owned || {};
  if (!b.equipped) return fromSimc;
  const out = { ...b.equipped };
  Object.keys(fromSimc).forEach((id) => {
    if (!out[id] || fromSimc[id] > out[id]) out[id] = fromSimc[id];
  });
  return out;
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
  const raw = (state.simc[b.key] || {}).lootSpec;
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
  const rows = Object.values(groups).map((g) =>
    priceGroup(b, g, selDiff, ownedGear(b), sp, take),
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
 * @param {import("./types.js").Board} b
 * @returns {{options: any[], keep: any, top: import("./types.js").Row|null, perRoll: number,
 *   verdict: "keep"|"roll", drag: {amount: number, name: string, isTop: boolean}|null}|null}
 *   null when no vault has been imported.
 */
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
  const simc = state.simc[b.key];
  if (!simc || !simc.vault || !simc.vault.length) return null;
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
  return st && st.stale ? null : b.vaultTake;
}

export function vaultChoice(b) {
  const simc = state.simc[b.key];
  if (!simc || !simc.vault || !simc.vault.length) return null;
  // An expired vault has no trade in it: the options are gone from the game, so there is nothing to
  // weigh a roll against. The panel says so rather than the app quietly ranking last week's items.
  const st = vaultStatus(b);
  if (st && st.stale) return null;

  // Each item's value in the report, and the item level that value was simmed at — which is not the
  // vault's copy of it. The two disagree routinely, and in both directions: a report from before
  // 12.1 sims the boss's drop, one after it sims the bonus roll's payout at the top of its track. So
  // the level is carried alongside the number rather than quietly folded into it; `vaultOptionHTML`
  // says so where they differ. Folded with the same `mergeRow` the pools use, because a vault option
  // priced off a different row of the report than the ranking is a comparison of two things.
  const scored = {};
  b.results.forEach((r) => {
    scored[r.item] = mergeRow(scored[r.item], r, false);
  });
  const options = simc.vault.map((v) => ({
    id: v.id,
    name: (QE_DATA.items[v.id] || {}).n || v.name,
    ilvl: v.ilvl,
    score: (scored[v.id] || {}).score || 0,
    scoredIlvl: (scored[v.id] || {}).scoreLvl || 0,
    // Distinguished from a genuine zero: an item the report never evaluated has no value we can
    // quote, and saying "worth 0" about it would be a claim we haven't earned.
    scored: scored[v.id] != null,
  }));
  const keep = options.slice().sort((a, c) => c.score - a.score)[0];

  const rows = buildGroups(Object.assign({}, b, { vaultTake: null })).rows;
  const top = rows.find((r) => r.ev > 0) || null;
  // The expected score of the one roll you'd actually make. Not `row.ev`, which is per *token* —
  // against a single vault slot the question is what one roll returns, with its price alongside.
  const perRoll = top ? top.num / top.remaining : 0;

  return {
    options,
    keep,
    top,
    perRoll,
    drag: dragOf(rows, keep),
    verdict: perRoll > keep.score ? "roll" : "keep",
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
 * @param {{id: number}} keep  The vault option the trade is measured against.
 */
function dragOf(rows, keep) {
  let worst = null;
  rows.forEach((r, i) => {
    const it = r.items.find((x) => x.id === keep.id);
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
