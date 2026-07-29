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
//
// Season 2's item levels below are read off the 12.1 PTR, via norumu's reward sheet:
// https://docs.google.com/spreadsheets/d/1BCDWQvv_HFRO97s8UCQr_7vwz0pFXQw6gbTBgM1VeOg/htmlview
// PTR numbers move. If they shift before launch, every figure that needs changing is in SEASONS[2].

/**
 * One rung of a payout that varies with how hard the content was — M+ key level, so far.
 *
 * Reference only: the app has no key-level input, so `Reward.ilvl` quotes the top rung and this is
 * what the reward pane shows to say what the quoted figure is the *ceiling* of. A `label` is only
 * carried where the season's own table pins that item level to a track step; Midnight's tracks
 * overlap by two, so an item level in the middle of the ladder can be read as two different steps
 * and guessing one would be inventing data.
 *
 * @typedef {Object} LadderStep
 * @property {string} at    Which keys pay this rung ("+4–5").
 * @property {number} ilvl  Item level it pays.
 * @property {string} [label]  Track and step, where it's known rather than inferred.
 */

/**
 * What a bonus roll actually hands you, when that isn't the item as the boss drops it.
 *
 * @typedef {Object} Reward
 * @property {string} label  Upgrade track and step, for display ("Myth 6/6"); "" when unrecognised.
 * @property {number|null} ilvl  Item level of that step — null until Blizzard publishes it. Null
 *   means "promoted, by an amount we don't know", which is not the same as "not promoted".
 * @property {number} [crests]  Upgrade crests the payout saves you, per roll. Zero where the roll
 *   lands on a track's first step, which is where a drop would have started anyway.
 * @property {string} [crestKind]  Which crest currency that is ("Myth").
 * @property {LadderStep[]} [ladder]  The full run of payouts this one is the top of, where the
 *   payout depends on something the app can't see. Display only — nothing prices off it.
 */

/**
 * Encounters at the end of a raid whose rewards are a class apart, and worth holding a token for.
 *
 * `lastBosses` counts back from the end of the raid rather than naming encounter ids, because the
 * raid this describes isn't in the database yet. Which encounters those are is worked out in
 * model.js, by encounter id — see `finalBosses` there for why that ordering is the only one
 * available and what it assumes.
 *
 * @typedef {Object} Special
 * @property {number} lastBosses  How many bosses at the end of a raid carry these rewards.
 * @property {string} badge  Short tag for the encounter card.
 * @property {number|null} ilvl  Item level those rewards drop and pay out at.
 * @property {string} note   One line on why the encounter is worth saving a token for.
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
 * @property {number} [tokenVaultWeeks]  Last week of the season in which that's true; from the week
 *   after, the token is a free weekly reward and the trade disappears. Wording only, as above.
 * @property {Record<string, Reward>|null} rollReward  Where a roll pays out, keyed by difficulty
 *   ("mythic"/"heroic"/"normal"/"lfr", plus "mythic-plus" for dungeons). Null when a roll simply
 *   hands you the drop, at the drop's own item level — the Season 1 behaviour.
 * @property {Special|null} special  End-of-raid encounters worth holding a token for; null when the
 *   season has no such tier.
 * @property {{name: string, url: string}} [source]  Where the figures above were read off, for the
 *   reward pane to cite. A pre-launch table is somebody's datamining until it isn't, and a reader
 *   deciding whether to trust a number needs to know whose.
 */

/** @type {Record<number, Season>} */
export const SEASONS = {
  1: {
    number: 1,
    expansion: "Midnight",
    qeSeasonId: 34,
    // A Season 1 roll is the drop, so there is no reward scheme to document: no promotion, no
    // crests banked, no end-of-raid tier. This is why the reward pane is pinned to Season 2.
    tokenRaid: 2,
    tokenDungeon: 1,
    tokenNote:
      "A raid boss costs 2 tokens in Season 1 and a M+ dungeon costs 1, so raid EV is halved against dungeon EV. Season 2 drops raids to 1 token.",
    rollReward: null, // a Season 1 roll hands you the item exactly as the boss drops it
    tokenFromVault: false,
    special: null,
  },
  2: {
    number: 2,
    expansion: "Midnight",
    qeSeasonId: null, // unknown until Season 2 is live on QE Live; `npm run data` prints it
    tokenRaid: 1,
    tokenDungeon: 1,
    tokenNote:
      "1 token for everything in Season 2, raid bosses and M+ dungeons alike. (Season 1 charged 2 per raid boss, which is why older notes halve raid EV.)",
    // Weeks 1–7 the token comes out of a Great Vault slot, so a roll is bought with the item you'd
    // otherwise have taken. From week 8 it's a free weekly reward again and the trade disappears.
    tokenFromVault: true,
    tokenVaultWeeks: 7,
    // Season 2 pays a bonus roll out as if the item had come from your Great Vault, not from the
    // boss. Vault rewards from LFR/Normal/Heroic jump to the first step of the next track, and a
    // Mythic vault arrives fully upgraded — so a Mythic boss and a M+ dungeon cost the same single
    // token and hand back items five upgrade steps apart (334 against 318).
    //
    // Midnight's tracks are six steps each, and each track starts four steps above the one below it,
    // so they overlap by two: Champion 1/6 = 292 … 6/6 = 308, Hero 1/6 = 305, Myth 1/6 = 318.
    //
    // The M+ figure is the payout for a +10 key or higher, which is where the track tops out. Lower
    // keys pay less (+2-3 → 305, +4-5 → 308, +6 → 311, +7-9 → 315), and there is nowhere in a QE
    // report to learn which key someone runs. Quoting the ceiling overstates a low-key roll by up to
    // 13 item levels, which is the safe direction: it can only leave an item on screen as Want that
    // a lower payout would have called a dupe, and an extra line argues with itself where a silently
    // dropped one doesn't. If key level ever becomes an input, this is the entry to split.
    //
    // The crest figures are what the payout saves you, and they follow from Larias' arithmetic:
    // 1,280 Myth crests to cap 16 slots is 80 per slot, so an item handed over at Myth 6/6 is 80
    // crests you never have to spend — the "80 free crests a week, unobtainable any other way".
    // Every other payout lands on the first step of a track, which is where a drop starts anyway,
    // so it saves no crests even though it is still a better item than the boss would have given.
    rollReward: {
      mythic: { label: "Myth 6/6", ilvl: 334, crests: 80, crestKind: "Myth" },
      heroic: { label: "Myth 1/6", ilvl: 318, crests: 0, crestKind: "Myth" },
      normal: { label: "Hero 1/6", ilvl: 305, crests: 0, crestKind: "Hero" },
      lfr: {
        label: "Champion 1/6",
        ilvl: 292,
        crests: 0,
        crestKind: "Champion",
      },
      "mythic-plus": {
        label: "Myth 1/6",
        ilvl: 318,
        crests: 0,
        crestKind: "Myth",
        // The rungs below the quoted one. Only the two ends carry a track step, and only because
        // the table above pins them: 305 is where Hero starts (a Normal boss pays it) and 318 is
        // where Myth starts (a Heroic boss pays it). The three in between sit inside the overlap
        // between two tracks — 308 is both Champion 6/6 and a Hero step — so they stay item levels.
        ladder: [
          { at: "+2–3", ilvl: 305, label: "Hero 1/6" },
          { at: "+4–5", ilvl: 308 },
          { at: "+6", ilvl: 311 },
          { at: "+7–9", ilvl: 315 },
          { at: "+10 or higher", ilvl: 318, label: "Myth 1/6" },
        ],
      },
    },
    // The last two Mythic bosses are the one place a roll promotes nothing: they drop at 344 and
    // their vault and bonus roll pay the same 344, three steps past Myth 6/6. The token is still
    // worth banking for them — it just buys a second shot at the drop rather than an upgrade of it.
    source: {
      name: "norumu’s 12.1 PTR reward sheet",
      url: "https://docs.google.com/spreadsheets/d/1BCDWQvv_HFRO97s8UCQr_7vwz0pFXQw6gbTBgM1VeOg/htmlview",
    },
    special: {
      lastBosses: 2,
      badge: "Venomcursed 9/6",
      ilvl: 344,
      note:
        "Its Mythic items are 9/6 (ilvl 344) with cantrip effects, a tier above anything else in " +
        "the game, and the reason most raiders bank a token for kill week instead of spending it here.",
    },
  },
};

// The season this build targets. Season 2 isn't out yet, and the shipped database is still
// Season 1 content, so the app describes itself as Season 1 rather than claiming otherwise.
const ACTIVE = 1;

export const SEASON = SEASONS[ACTIVE];

/** Masthead / documentation label, e.g. "WoW S1 Midnight". */
export const SEASON_LABEL = "WoW S" + SEASON.number + " " + SEASON.expansion;

/** Full name of a season, spelled out — what a panel about it has to be headed with. */
export function seasonName(s) {
  return s.expansion + " Season " + s.number;
}

/**
 * The season the reward pane documents.
 *
 * Pinned to 2 rather than following ACTIVE, on purpose. Season 1 has no reward scheme worth a panel
 * — a roll hands you the drop — so the pane would be an empty box for as long as the app targets it.
 * Season 2's rules, meanwhile, are what a raider needs *before* the season starts, which is exactly
 * when ACTIVE still says 1. The pane therefore always names its season in the heading, and says
 * whether it's the one the rest of the page is ranking (`REWARDS_LIVE`).
 *
 * When a Season 3 reward scheme is known, point this at it and the pane follows.
 */
export const REWARD_SEASON = SEASONS[2];

/** Is the season the pane describes the one the rest of the app is pricing? */
export const REWARDS_LIVE = REWARD_SEASON === SEASON;

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
  return (
    table[type === "dungeon" ? "mythic-plus" : String(diffKey)] || {
      label: "",
      ilvl: null,
    }
  );
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
