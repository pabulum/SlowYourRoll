// Everything that changes when the game rolls over to a new season.
//
// Which encounters are *current* is not here — that comes from the generated database
// (`QE_DATA.currentRaids` / `currentDungeons`), which tracks QE Live's own constants. This file
// holds what QE Live doesn't tell us: what to call the season, what a bonus roll costs, and what a
// roll actually pays out.
//
// To move to Season 2:
//   1. `npm run data`   — pulls the new current raids/dungeons from a QE Live checkout.
//   2. Set ACTIVE below to 2, and fill in that season's `qeSeasonId` from the build output.
//   3. Fill in the `rollReward` item levels once Midnight's upgrade tracks are published.
// The app warns on its own when step 1 has happened but step 2 hasn't (see seasonDrift). Step 3 is
// safe to leave undone: a null item level degrades to "promoted, amount unknown", which suppresses
// the dupe guess rather than getting it wrong.

/**
 * What a bonus roll actually hands you, when that isn't the item as the boss drops it.
 *
 * @typedef {Object} Reward
 * @property {string} label  Upgrade track and step, for display ("Myth 6/6"); "" when unrecognised.
 * @property {number|null} ilvl  Item level of that step — null until Blizzard publishes it. Null
 *   means "promoted, by an amount we don't know", which is not the same as "not promoted".
 */

/**
 * @typedef {Object} Season
 * @property {number} number       Season number within the expansion.
 * @property {string} expansion    Expansion name.
 * @property {number|null} qeSeasonId  QE Live's own CONSTANTS.seasonID for this season, once known.
 * @property {number} tokenRaid    Bonus-roll token cost for a raid boss.
 * @property {number} tokenDungeon Bonus-roll token cost for a M+ dungeon.
 * @property {string} tokenNote    Plain-English summary of the token economy, shown in the legend.
 * @property {boolean} tokenFromVault  True when the bonus-roll token is itself a Great Vault
 *   reward, so taking it costs you the item you'd otherwise have picked. Only changes the wording
 *   of the vault comparison, never its arithmetic — a wrong guess here misleads nobody's maths.
 * @property {Record<string, Reward>|null} rollReward  Where a roll pays out, keyed by difficulty
 *   ("mythic"/"heroic"/"normal"/"lfr", plus "mythic-plus" for dungeons). Null when a roll simply
 *   hands you the drop, at the drop's own item level — the Season 1 behaviour.
 */

/** @type {Record<number, Season>} */
export const SEASONS = {
  1: {
    number: 1,
    expansion: "Midnight",
    qeSeasonId: 34,
    tokenRaid: 2,
    tokenDungeon: 1,
    tokenNote: "A raid boss costs 2 tokens in Season 1 and a M+ dungeon costs 1, so raid EV is halved against dungeon EV. Season 2 drops raids to 1 token.",
    rollReward: null, // a Season 1 roll hands you the item exactly as the boss drops it
    tokenFromVault: false,
  },
  2: {
    number: 2,
    expansion: "Midnight",
    qeSeasonId: null, // unknown until Season 2 is live on QE Live; `npm run data` prints it
    tokenRaid: 1,
    tokenDungeon: 1,
    tokenNote: "Everything costs 1 token in Season 2 — raid bosses and M+ dungeons alike. (Season 1 charged 2 for raid bosses, which is why older notes divide raid EV by 2.)",
    // Weeks 1–7 the token comes out of a Great Vault slot, so a roll is bought with the item you'd
    // otherwise have taken. From week 8 it's a free weekly reward again and the trade disappears.
    tokenFromVault: true,
    // Season 2 pays a bonus roll out as if the item had come from your Great Vault, not from the
    // boss. Vault rewards from LFR/Normal/Heroic jump to the first step of the next track, and a
    // Mythic vault arrives fully upgraded — so a Mythic boss and a M+ dungeon cost the same single
    // token and hand back items five upgrade steps apart. Item levels are null because Blizzard
    // hasn't published Midnight's track values; the tracks themselves are the part that's known.
    rollReward: {
      mythic: { label: "Myth 6/6", ilvl: null },
      heroic: { label: "Myth 1/6", ilvl: null },
      normal: { label: "Hero 1/6", ilvl: null },
      lfr: { label: "Champion 1/8", ilvl: null },
      "mythic-plus": { label: "Myth 1/6", ilvl: null },
    },
  },
};

// The season this build targets. Season 2 isn't out yet, and the shipped database is still
// Season 1 content, so the app describes itself as Season 1 rather than claiming otherwise.
const ACTIVE = 1;

export const SEASON = SEASONS[ACTIVE];

/** Masthead / documentation label, e.g. "WoW S1 Midnight". */
export const SEASON_LABEL = "WoW S" + SEASON.number + " " + SEASON.expansion;

/**
 * What a bonus roll on this kind of source, at this difficulty, would actually hand you.
 *
 * Returns null when the season doesn't promote rewards at all — a roll is just the drop, so the
 * drop's own item level is the honest answer and callers should use it. Otherwise it always returns
 * a Reward, falling back to a blank one for a difficulty it doesn't recognise: in a season that
 * promotes, "I can't tell which step" must not be mistaken for "no promotion", because the two
 * disagree about whether a copy you already own makes the roll redundant.
 *
 * @param {Season} season
 * @param {"raid"|"dungeon"} type
 * @param {string} [diffKey]  Canonical difficulty ("mythic", "heroic", …); ignored for dungeons.
 * @returns {Reward|null}
 */
export function rewardOf(season, type, diffKey) {
  const table = season.rollReward;
  if (!table) return null;
  return table[type === "dungeon" ? "mythic-plus" : String(diffKey)] || { label: "", ilvl: null };
}

/** `rewardOf` against the season this build targets. */
export function rollReward(type, diffKey) {
  return rewardOf(SEASON, type, diffKey);
}

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
