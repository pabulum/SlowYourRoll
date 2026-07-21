// Everything that changes when the game rolls over to a new season.
//
// Which encounters are *current* is not here — that comes from the generated database
// (`QE_DATA.currentRaids` / `currentDungeons`), which tracks QE Live's own constants. This file
// holds what QE Live doesn't tell us: what to call the season, and what a bonus roll costs.
//
// To move to Season 2:
//   1. `npm run data`   — pulls the new current raids/dungeons from a QE Live checkout.
//   2. Set ACTIVE below to 2, and fill in that season's `qeSeasonId` from the build output.
// The app warns on its own when step 1 has happened but step 2 hasn't (see seasonDrift).

/**
 * @typedef {Object} Season
 * @property {number} number       Season number within the expansion.
 * @property {string} expansion    Expansion name.
 * @property {number|null} qeSeasonId  QE Live's own CONSTANTS.seasonID for this season, once known.
 * @property {number} tokenRaid    Bonus-roll token cost for a raid boss.
 * @property {number} tokenDungeon Bonus-roll token cost for a M+ dungeon.
 * @property {string} tokenNote    Plain-English summary of the token economy, shown in the legend.
 */

/** @type {Record<number, Season>} */
const SEASONS = {
  1: {
    number: 1,
    expansion: "Midnight",
    qeSeasonId: 34,
    tokenRaid: 2,
    tokenDungeon: 1,
    tokenNote: "A raid boss costs 2 tokens in Season 1 and a M+ dungeon costs 1, so raid EV is halved against dungeon EV. Season 2 drops raids to 1 token.",
  },
  2: {
    number: 2,
    expansion: "Midnight",
    qeSeasonId: null, // unknown until Season 2 is live on QE Live; `npm run data` prints it
    tokenRaid: 1,
    tokenDungeon: 1,
    tokenNote: "Everything costs 1 token in Season 2 — raid bosses and M+ dungeons alike. (Season 1 charged 2 for raid bosses, which is why older notes divide raid EV by 2.)",
  },
};

// The season this build targets. Season 2 isn't out yet, and the shipped database is still
// Season 1 content, so the app describes itself as Season 1 rather than claiming otherwise.
const ACTIVE = 1;

export const SEASON = SEASONS[ACTIVE];

/** Masthead / documentation label, e.g. "WoW S1 Midnight". */
export const SEASON_LABEL = "WoW S" + SEASON.number + " " + SEASON.expansion;

/**
 * Has the encounter database moved to a season this build doesn't know about? True once
 * `npm run data` picks up a new QE season id but ACTIVE above hasn't been bumped to match —
 * which is exactly when the token costs and the season label are about to be wrong.
 * @param {number|undefined} dataSeasonId  QE_DATA.seasonId from the generated database.
 */
export function seasonDrift(dataSeasonId) {
  if (dataSeasonId == null || SEASON.qeSeasonId == null) return false;
  return dataSeasonId !== SEASON.qeSeasonId;
}
