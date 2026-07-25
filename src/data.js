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
