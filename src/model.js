// The expected-value model: resolve encounters, group a report's results by source,
// score each pool, and rank sources by EV.
//
//   EV = ( Σ score of items you still "want" ÷ items still in the pool ) ÷ token cost

import { QE_DATA, DIFF_NAMES, DIFF_ORDER } from "./data.js";
import { SEASON } from "./season.js";
import { state } from "./store.js";
import { canLoot, specId, classSpecs } from "./loot.js";
import { fmt } from "./util.js";

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
    if (dn) return { type: "dungeon", name: dn, current: QE_DATA.currentDungeons.indexOf(String(encId)) >= 0 };
    return { type: "dungeon", name: "Unknown dungeon " + encId, current: true, unknown: true };
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
    if ((QE_DATA.ignoredInstances || []).indexOf(String(instId)) >= 0) return null;
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
    current: QE_DATA.currentRaids.indexOf(String(instId)) >= 0,
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
    : ((QE_DATA.items[r.item] || {}).s) || [];
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
      if (info && info.type === "raid" && (state.showAll || info.current)) set[String(rd)] = 1;
    });
  });
  return Object.keys(set).sort((a, c) => diffRank(c) - diffRank(a));
}

/** Human label for a difficulty value (named string, or a QE numeric index). */
export function diffLabel(b, d) {
  d = String(d);
  if (/[a-z]/i.test(d)) {
    const t = d.split("-").pop(); // "raid-mythic" -> "mythic"
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const ds = raidDiffs(b), i = ds.indexOf(d); // QE numeric index -> rank name
  return DIFF_NAMES[i] || ("Diff " + d);
}

/**
 * The same encounter, rolled as each of the character's other specs.
 *
 * Loot spec is a lever on the pool, not just a filter: dropping an item you'd never want shortens
 * the denominator and every remaining item's odds go up. The classic case is a Mistweaver at Pit of
 * Saron, where looting as Windwalker sheds Nevermelting Ice Crystal and keeps every piece of
 * leather. So each alternative is costed the same way as the current one, and named by what it
 * drops and what it gives up.
 *
 * Values are the report's, which only ever simmed one spec — fine for "what would I stop being
 * offered", not for "what is this worth to the other spec". Rows keep only the better options.
 */
function altSpecs(items, sp, cost, ev) {
  if (!sp) return [];
  const live = items.filter((i) => i.state !== "rolled");
  return classSpecs(sp).filter((s) => s !== sp).map((s) => {
    const has = (i) => (i.specs || []).indexOf(s) >= 0;
    const pool = live.filter(has);
    const num = pool.reduce((t, i) => t + (i.state === "want" ? i.score : 0), 0);
    return {
      spec: s,
      remaining: pool.length,
      num,
      ev: pool.length > 0 ? num / pool.length / cost : 0,
      dodges: live.filter((i) => i.elig !== false && !has(i)).map((i) => i.name),
      gains: live.filter((i) => i.elig === false && has(i)).map((i) => i.name),
      loses: live.filter((i) => i.elig !== false && !has(i) && i.score > 0).map((i) => i.name),
    };
  }).filter((a) => a.ev > ev).sort((a, c) => c.ev - a.ev);
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
 * Build the ranked list of rollable sources for a board at its selected difficulty.
 * Returns { rows, selDiff, diffs, unknown } where each row carries its items, pool size, and EV,
 * and `unknown` names the visible sources the encounter database couldn't identify.
 * @param {import("./types.js").Board} b
 * @returns {{ rows: import("./types.js").Row[], selDiff: string, diffs: string[], unknown: string[] }}
 */
export function buildGroups(b) {
  const sp = b.lootSpec || specId(b.spec);
  const diffs = raidDiffs(b);
  const selDiff = (b.raidDiff != null && diffs.indexOf(String(b.raidDiff)) >= 0) ? String(b.raidDiff) : diffs[0];
  const groups = {};
  const unknown = {};

  b.results.forEach((r) => {
    const rd = String(diffOf(b, r));
    srcList(b, r).forEach((s) => {
      const instId = s[0], encId = s[1], vr = s.length > 2 && s[2];
      const info = resolve(instId, encId);
      if (!info) return;
      if (!state.showAll && !info.current) return;
      if (info.type === "raid" && diffs.length && rd !== selDiff) return;
      const key = instId + ":" + encId;
      // Only count unknowns that survive the filters — an unidentified source the user can't
      // see isn't a staleness signal worth interrupting them over.
      if (info.unknown) unknown[key] = info.type === "dungeon" ? info.name : info.instName + " · " + info.name;
      const meta = /** @type {Partial<import("./types.js").Item>} */ (QE_DATA.items[r.item] || {});
      const g = groups[key] || (groups[key] = { key, type: info.type, name: info.name, instName: info.instName || "", items: {} });
      const ex = g.items[r.item], sc = r.score || 0;
      // A report can list items this character's loot spec can't be given — QE evaluates a healer
      // trinket and the caster-DPS one beside it alike. Keep them, flagged: they're visible but out
      // of the pool, since a bonus roll can't hand you one.
      const lt = canLoot(meta, sp);
      if (!ex || sc > ex.score) {
        g.items[r.item] = {
          id: r.item, name: meta.n || ("Item " + r.item), q: meta.q || 3, score: sc, lvl: r.level, vr,
          elig: lt.ok, why: lt.why || "", swap: lt.swap || null, specs: eligibleSpecs(meta, sp),
        };
      }
    });
  });

  // A report only scores what it evaluated, but a bonus roll draws from the whole loot table — so
  // the rest of each boss's drops belong in the pool at zero value. Leaving them out was the other
  // half of the EV error: it shrinks the denominator, flattering every encounter the report is
  // thin on. They render as fillers, folded away behind the "no upgrade" toggle.
  Object.keys(groups).forEach((key) => {
    const g = groups[key];
    itemsAt(key).forEach((id) => {
      if (g.items[id]) return;
      const meta = QE_DATA.items[id];
      const src = meta.s.filter((x) => x[0] + ":" + x[1] === key)[0] || [];
      const lt = canLoot(meta, sp);
      g.items[id] = {
        id: Number(id), name: meta.n, q: meta.q || 3, score: 0, lvl: 0, vr: !!src[2],
        elig: lt.ok, why: lt.why || "", swap: lt.swap || null, specs: eligibleSpecs(meta, sp),
      };
    });
  });

  const ownedMap = ((state.simc[b.key] || {}).owned) || {};
  const rows = Object.keys(groups).map((k) => {
    const g = groups[k];
    const items = Object.keys(g.items).map((id) => {
      const it = g.items[id], ov = b.overlay[g.key + ":" + id];
      it.ownedIlvl = ownedMap[id] != null ? ownedMap[id] : null;
      const autoOwn = it.ownedIlvl != null && it.lvl && it.ownedIlvl >= it.lvl; // hold a copy at >= the drop's ilvl -> dupe
      it.state = ov === "rolled" ? "rolled"
        : (ov === "own" ? "own"
          : (b.vaultTake === Number(id) ? "own"
            : (autoOwn ? "own" : "want")));
      return it;
    }).sort((a, c) => c.score - a.score || a.name.localeCompare(c.name));
    // Ineligible items are shown but never counted: they can't dilute a pool they can't be in.
    const canGet = items.filter((i) => i.elig !== false);
    const remaining = canGet.filter((i) => i.state !== "rolled").length;
    const num = canGet.reduce((t, i) => t + (i.state === "want" ? i.score : 0), 0);
    // Token cost follows the season unless the user overrode this encounter. The per-board
    // tokenRaid/tokenDungeon fields older saves carry were never user-editable, so they're ignored.
    const cost = b.tokenOverride[g.key] || (g.type === "raid" ? SEASON.tokenRaid : SEASON.tokenDungeon) || 1;
    const ev = remaining > 0 ? num / remaining / cost : 0;
    return {
      g, items, remaining, num, cost, ev,
      nWant: canGet.filter((i) => i.state === "want" && i.score > 0).length,
      nBlocked: items.length - canGet.length,
      alts: altSpecs(items, sp, cost, ev),
    };
  });
  rows.sort((a, c) => c.ev - a.ev || c.num - a.num || a.g.name.localeCompare(c.g.name));
  return { rows, selDiff, diffs, unknown: Object.keys(unknown).map((k) => unknown[k]) };
}

// Display scaling: Droptimizer boards can show raw DPS or % of baseline.
function facOf(b) {
  return (b.source === "droptimizer" && b.metric === "pct") ? 100 / (b.baseline || 1) : 1;
}

/** Unit label for a board's scores. */
export function unitOf(b) {
  return b.source === "droptimizer" ? (b.metric === "pct" ? "% dps" : "dps") : "value";
}

/** Format a raw score in the board's chosen display unit. */
export function dv(b, v) {
  return fmt(v * facOf(b));
}
