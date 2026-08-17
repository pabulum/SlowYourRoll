// The encounter + item database, and the difficulty vocabulary used across the app.
//
// QE_DATA shape (see data/qe-data.json):
//   raids:    { [instId]: { name, bosses: { [encId]: bossName } } }
//   dungeons: { [encId]: dungeonName }
//   currentRaids / currentDungeons: string ids that count as "current" content
//   items:    { [itemId]: { n: name, q: quality (2-5), s: [[instId, encId, veryRare?], ...] } }
//             s = the sources that drop this item; a third truthy element flags a "very rare" drop.
//             instId === -1 marks a M+ dungeon source (encId indexes into `dungeons`).

// Fetched rather than imported, so the ~70KB (brotli) database stays off the critical path: the
// shell, the season note and the empty state all paint without it, and nothing the app can do
// before a report is loaded needs an item table. Consumers read the live binding below and must
// treat null as "not in yet" — render() and readSimc() both re-render when it arrives.
//
// This is an ES module live binding: importers see the assignment in loadQEData().
/** @type {import("./types.js").QEData | null} */
export let QE_DATA = null;

/** @type {Promise<import("./types.js").QEData> | null} */
let pending = null;

/**
 * Load the database, at most once per page. Safe (and cheap) to call from anywhere that needs the
 * data — repeat callers get the same promise, so an already-loaded database resolves on a microtask
 * rather than re-fetching. Rejects if the file can't be fetched; callers surface that to the user.
 */
export function loadQEData() {
  if (!pending) {
    pending = fetch(new URL("../data/qe-data.json", import.meta.url))
      .then((r) => {
        if (!r.ok) throw new Error(`qe-data.json: HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => (QE_DATA = d))
      .catch((e) => {
        // Don't cache the failure — a transient network blip shouldn't wedge the app for the
        // rest of the session when the next paste could retry successfully.
        pending = null;
        throw e;
      });
  }
  return pending;
}

/** Inject the database directly. For tests, which read it off disk instead of over HTTP. */
export function setQEData(d) {
  QE_DATA = d;
  pending = Promise.resolve(d);
}

/**
 * QE Live's raid-difficulty scale, as the 12.1 Upgrade Finder release encodes it. A QE report's
 * `dropDifficulty` on a raid row is an index straight into this list.
 *
 * Four values, because 12.1 split what used to be one axis into two. The old slider interleaved
 * each difficulty with a "(Max)" twin meaning "that difficulty's item, upgraded to the top of its
 * track"; 12.1 moved that onto its own `dropType` field (see `QE_DROP_TYPES`) and left the
 * difficulty itself as the four difficulties the game has. The same release also dropped the
 * ability to sim two difficulties at once, so a modern report carries exactly one of these.
 *
 * Read off `itemLevels.raid` in QE's `ItemLevelsDB.ts`, which is indexed by this value — *not* off
 * `convertRaidDifficultyToString` in `UpgradeFinderEngine.js`, which upstream left on the old
 * eight-entry list and which now mislabels every difficulty it is handed. That stale function is
 * where this app's own copy came from, and mirroring it is what made a Mythic report read as Normal.
 */
export const QE_RAID_DIFFICULTIES = [
  "Raid Finder",
  "Normal",
  "Heroic",
  "Mythic",
];

/**
 * The same slider as QE Live shipped it before 12.1, which is the scale a Season 1 report is
 * written in. Kept because reports are saved to localStorage and outlive the patch that produced
 * them: a board loaded last season still has to label its own difficulties correctly.
 *
 * "(Max)" is the same difficulty at the top of its upgrade track rather than a difficulty of its
 * own — QE's Season 1 item levels put Mythic at 272 and Mythic (Max) at 289. Both pay out on the
 * Mythic track, which is why `diffKey` folds the suffix away before asking the season what a roll
 * is worth.
 *
 * See `qeIsModern` in model.js for how a board is told apart from a modern one.
 */
export const QE_RAID_DIFFICULTIES_LEGACY = [
  "Raid Finder",
  "Raid Finder (Max)",
  "Normal",
  "Normal (Max)",
  "Heroic",
  "Heroic (Max)",
  "Mythic",
  "Mythic (Max)",
];

/**
 * What a 12.1 report's `dropType` says about the row it's on. Three rows now arrive for every item
 * at every source, and they are three different item levels of the same item — not three items, and
 * not a range to take the best of.
 *
 *   drop   the item as the boss (or the end-of-run chest) hands it over.
 *   max    that same drop taken to the top of its own upgrade track, crests spent.
 *   bonus  what a bonus roll pays for that source, taken to the top of *its* track — which is a
 *          track higher, since a roll pays out as if the item came from your Great Vault.
 *
 * `bonus` is the row this app is about: it is QE simming the exact thing the ranking prices. See
 * `mergeRow` in model.js, which is where the three are folded back into one pool item.
 */
export const QE_DROP_TYPES = ["drop", "max", "bonus"];

/**
 * QE Live's Mythic+ key slider, as 12.1 encodes it: a dungeon row's `dropDifficulty` (and
 * `ufSettings.dungeon`) is an index into this list. Mirrored from `MPLUS_KEY_REWARDS` in QE's
 * `Databases/MPlusKeyRewards.ts`.
 *
 * Display only — what each key *pays* is the season's business, not QE's, and lives in
 * `SEASON.rollReward["mythic-plus"].ladder`, whose rungs name these indices.
 */
export const QE_MPLUS_KEYS = [
  "M0",
  "+2–3",
  "+4",
  "+5",
  "+6",
  "+7",
  "+8–9",
  "+10 or higher",
];

/** Sort weight for a named difficulty; higher = harder / better loot. */
export const DIFF_ORDER = {
  "raid-mythic": 40,
  mythic: 40,
  "raid-heroic": 30,
  heroic: 30,
  "raid-normal": 20,
  normal: 20,
  "raid-lfr": 10,
  lfr: 10,
  "raid-finder": 10,
  "mythic-plus": 25,
};
