// The encounter + item database, and the difficulty vocabulary used across the app.
//
// QE_DATA shape (see data/qe-data.js):
//   raids:    { [instId]: { name, bosses: { [encId]: bossName } } }
//   dungeons: { [encId]: dungeonName }
//   currentRaids / currentDungeons: string ids that count as "current" content
//   items:    { [itemId]: { n: name, q: quality (2-5), s: [[instId, encId, veryRare?], ...] } }
//             s = the sources that drop this item; a third truthy element flags a "very rare" drop.
//             instId === -1 marks a M+ dungeon source (encId indexes into `dungeons`).

import { QE_DATA as RAW_QE_DATA } from "../data/qe-data.js";

/** @type {import("./types.js").QEData} */
export const QE_DATA = RAW_QE_DATA;

/** Rank names for QE reports, best-first (they encode difficulty as a numeric index). */
export const DIFF_NAMES = ["Mythic", "Heroic", "Normal", "LFR", "Raid"];

/** Sort weight for a named difficulty; higher = harder / better loot. */
export const DIFF_ORDER = {
  "raid-mythic": 40, "mythic": 40,
  "raid-heroic": 30, "heroic": 30,
  "raid-normal": 20, "normal": 20,
  "raid-lfr": 10, "lfr": 10, "raid-finder": 10,
  "mythic-plus": 25,
};
