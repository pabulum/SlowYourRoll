// Everything that changes when the game rolls over to a new season.
//
// Which encounters are *current* is not here — that comes from the generated database
// (`QE_DATA.currentRaids` / `currentDungeons`), which tracks QE Live's own constants. This file
// holds what QE Live doesn't tell us: what to call the season, what a bonus roll costs, and what a
// roll actually pays out.
//
// To move to a new season:
//   1. `npm run data`   — pulls the new current raids/dungeons from a QE Live checkout.
//   2. Set ACTIVE below to that season, and copy the build's "Current raids" ids into `qeRaids`.
//   3. Fill in the `rollReward` item levels once the expansion's upgrade tracks are published.
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
 * A rung is a `Reward` in its own right, not a footnote to one: where the report says which key was
 * run, `rewardOf` returns the rung and every figure on the card comes from it. Where it doesn't,
 * `Reward.ilvl` quotes the top rung and the ladder is what the reward pane shows to say what that
 * quote is the *ceiling* of. A `label` is only carried where the season's own table pins that item
 * level to a track step; Midnight's tracks overlap by two, so an item level in the middle of the
 * ladder can be read as two different steps and guessing one would be inventing data.
 *
 * @typedef {Object} LadderStep
 * @property {string} at    Which keys pay this rung ("+4–5").
 * @property {number} ilvl  Item level it pays.
 * @property {string} [label]  Track and step, where it's known rather than inferred.
 * @property {number} [crests]  Crests this rung's payout saves you, as on a Reward.
 * @property {string} [crestKind]  Which crest currency that is.
 * @property {number[]} [keys]  QE Live key-slider indices that land on this rung — the join between
 *   a report's `dropDifficulty` on a dungeon row and what that key actually pays. Mirrored from
 *   `MPLUS_KEY_REWARDS` in QE's `Databases/MPlusKeyRewards.ts`; see `QE_MPLUS_KEYS` in data.js.
 */

/**
 * What a bonus roll actually hands you, when that isn't the item as the boss drops it.
 *
 * @typedef {Object} Reward
 * @property {string} label  Upgrade track and step, for display ("Myth 6/6"); "" when unrecognised.
 * @property {number|null} ilvl  Item level of that step — null until Blizzard publishes it. Null
 *   means "promoted, by an amount we don't know", which is not the same as "not promoted".
 * @property {number} [crests]  Upgrade crests the payout saves you, per roll — the **maximum**, for a
 *   slot that hasn't been up this track yet. It only falls from here, as a slot climbs and there is
 *   less left to buy; `crestSavingAt` computes the figure for a known watermark. Zero where the roll
 *   lands on a track's first step, which is where a drop would have started anyway.
 * @property {string} [crestKind]  Which crest currency that is ("Myth").
 * @property {number} [crestFrom]  Item level this payout's own track starts at — the floor its
 *   `crests` buy the climb from ("Myth 1/6", 318, for a payout of "Myth 6/6", 334). Stated rather
 *   than read off whichever other row happens to share the number, and it is the threshold a slot's
 *   high watermark is compared against: a slot already at or above it has had part of that climb
 *   paid for, so a roll into it saves less than the full figure. Absent where nothing is saved.
 * @property {number} [crestPerStep]  Crests one step up this track costs — flat across every slot
 *   in Midnight, two-handers included.
 * @property {number[]} [crestSteps]  Item level of each step on this track, first to last. With
 *   `crestPerStep` this is the whole cost model: every step above `crestFrom` that a slot's watermark
 *   doesn't already cover costs `crestPerStep`. Kept so the arithmetic is checkable rather than a
 *   number nobody can re-derive.
 * @property {number} [crestFreeTo]  Item level a slot reaches without spending *this* track's crests,
 *   which is a floor on the watermark rather than a guess at it. 321 in Season 2: Hero 6/6, which the
 *   tracks' two-step overlap also makes Myth 2/6, so taking a Heroic item in that slot to the top of
 *   the Hero track — in Hero crests, which M+ hands out freely — covers the first Myth step. Anyone
 *   paying Myth crests for that step has simply misplayed, so `crestSavingAt` clamps to this and the
 *   figure never claims the roll saved you from it.
 * @property {LadderStep[]} [ladder]  The full run of payouts this one is the top of, where the
 *   payout depends on something the app can't see. Display only — nothing prices off it.
 */

/**
 * Encounters at the end of a raid whose rewards are a class apart, and worth holding a token for.
 *
 * `lastBosses` counts back from the end of the raid rather than naming encounter ids, which keeps
 * this readable as a rule and survives the raid being replaced. Which encounters those are is worked
 * out in model.js — see `finalBosses`, and note that it reads the raid's recorded pull order,
 * because Venomous Abyss is the raid where encounter id and pull order stopped agreeing.
 *
 * @typedef {Object} Special
 * @property {string} [raid]  Instance id of the raid these rewards belong to. Worth naming once the
 *   season has more than one raid on the page: the Season 2 list pairs the tier raid with a one-boss
 *   flex world boss, and "the last two bosses" is a true sentence about the first and a meaningless
 *   one about the second. Omit where the season's only raid is the tier raid.
 * @property {number} lastBosses  How many bosses at the end of that raid carry these rewards.
 * @property {string} badge  Short tag for the encounter card, naming the top-tier reward.
 * @property {string} [badgeAlt]  The tag to wear at a difficulty that doesn't pay those rewards.
 *   `badge` quotes an item level — "Venomcursed 9/6" — and a Heroic roll on the same boss pays Myth
 *   1/6 like any other Heroic boss, so wearing it there claims five upgrade steps the card can't
 *   hand over. The encounter is still special at every difficulty, for the reason `heroicNote`
 *   gives, so the badge changes rather than disappearing.
 * @property {number|null} ilvl  Item level those rewards drop and pay out at.
 * @property {string} note   One line on why the encounter is worth saving a token for.
 * @property {string} [heroicNote]  Why the same encounters are worth rolling at a *lower* difficulty
 *   than the one `ilvl` describes. Separate from `note` because it argues the opposite way — spend
 *   the token now rather than bank it — and a reader deciding between the two needs both, not a
 *   sentence that has quietly averaged them.
 */

/**
 * @typedef {Object} Season
 * @property {number} number       Season number within the expansion.
 * @property {string} expansion    Expansion name.
 * @property {number|null} qeSeasonId  QE Live's own CONSTANTS.seasonID for this season, once known.
 *   Midnight Seasons 1 and 2 both carry 34 — upstream moved the raid list and left this alone — so
 *   it identifies the expansion's database more than the season, and `qeRaids` is what actually
 *   detects a rollover. Kept because it is still the field upstream means as a season id.
 * @property {string[]} [qeRaids]  The raid ids QE Live lists as current while this season is on,
 *   in upstream's own order. This is the fingerprint `seasonDrift` compares against, and the only
 *   one that moves at a season boundary. Absent means "don't check", which is what a season whose
 *   raid list nobody has recorded should do rather than warn about every build.
 * @property {number} tokenRaid    Bonus-roll token cost for a raid boss.
 * @property {number} tokenDungeon Bonus-roll token cost for a M+ dungeon.
 * @property {string} tokenNote    Plain-English summary of the token economy, shown in the legend.
 * @property {boolean} tokenFromVault  True when the bonus-roll token is itself a Great Vault
 *   reward, so taking it costs you the item you'd otherwise have picked. Only changes the wording
 *   of the vault comparison, never its arithmetic — a wrong guess here misleads nobody's maths.
 * @property {number} [tokenVaultFrom]  First week of the season in which the token can be taken at
 *   all. Defaults to week 1; Season 2 withholds it from the opening vault. Wording only, as above.
 * @property {number} [tokenVaultWeeks]  Last week of the season in which that's true; from the week
 *   after, the token is a free weekly reward and the trade disappears. Wording only, as above.
 * @property {string} [week1]  ISO instant of the weekly reset that opens week 1 — the anchor every
 *   week number on the page is counted from. Absent where a season's calendar isn't published,
 *   which leaves those week numbers abstract rather than wrong.
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
    qeRaids: ["1307", "1314", "1308", "1305"], // Voidspire, Dreamrift, Quel'Danas, Sporefall
    // A Season 1 roll is the drop, so there is no reward scheme to document: no promotion, no
    // crests saved, no end-of-raid tier. This is why the reward pane is pinned to Season 2.
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
    qeSeasonId: 34, // unchanged from Season 1 upstream — see the typedef; qeRaids is the real tell
    qeRaids: ["1320", "1317"], // Venomous Abyss, and Tidebound Grotto as the flex world boss
    tokenRaid: 1,
    tokenDungeon: 1,
    tokenNote:
      "1 token for everything in Season 2, raid bosses and M+ dungeons alike. (Season 1 charged 2 per raid boss, which is why older notes halve raid EV.)",
    // Weeks 2–7 the token comes out of a Great Vault slot, so a roll is bought with the item you'd
    // otherwise have taken. From week 8 it's a free weekly reward again and the trade disappears.
    //
    // The window opens in week 2, not week 1: Blizzard's 2026-07-31 season post says a Voidcore is
    // not offered in the opening vault of Season 2 and first appears on August 25. Guides written
    // before that date — Larias' 7/30 draft among them — plan a week 1 roll that isn't there.
    // https://us.forums.blizzard.com/en/wow/t/midnight-season-1-ending-and-season-2-information/2331696
    tokenFromVault: true,
    tokenVaultFrom: 2,
    tokenVaultWeeks: 7,
    // Larias' week-by-week dates the season: pre-season August 11, week 1 August 18, then every
    // week by sevens (week 2 August 25, week 3 September 1 …), which is what turns the window above
    // from a rule into an answer. Unchanged through the 8/10 revision. Quoted at the US reset — 8am
    // Pacific, 15:00 UTC in August. Other regions reset later in the same day, so for those hours
    // the count runs a week ahead of the reader; see `seasonWeek` for why that's worn not fixed.
    //
    // The guide has a stable home now, which is worth recording because every date and most of the
    // advice below is read off it and it is revised most days: https://lariasguide.com
    week1: "2026-08-18T15:00:00Z",
    // Season 2 pays a bonus roll out as if the item had come from your Great Vault, not from the
    // boss. Vault rewards from LFR/Normal/Heroic jump to the first step of the next track, and a
    // Mythic vault arrives fully upgraded — so a Mythic boss and a M+ dungeon cost the same single
    // token and hand back items five upgrade steps apart (334 against 318).
    //
    // Midnight's tracks are six steps each, and each track starts four steps above the one below it,
    // so they overlap by two: Champion 1/6 = 292 … 6/6 = 308, Hero 1/6 = 305, Myth 1/6 = 318.
    //
    // The M+ figure is the payout for a +10 key or higher, which is where the track tops out. Lower
    // keys pay less, and the `ladder` below is now a real lookup rather than a footnote: QE Live's
    // 12.1 Upgrade Finder records the key the report was run at, so `rewardOf` resolves the rung and
    // the card quotes what that key actually pays. The top rung remains the answer for a report that
    // doesn't say — a Droptimizer, or anything from before 12.1. Quoting the ceiling there overstates
    // a low-key roll by up to 16 item levels, which is the safe direction: it can only leave an item
    // on screen as Want that a lower payout would have called a dupe, and an extra line argues with
    // itself where a silently dropped one doesn't.
    //
    // The crest figure is what the payout saves you. The step tables are read off the game's own
    // upgrade data — QE's `src/Retail/Engine/BonusIDs.ts`, every Midnight step under `seasonId: 37`
    // with its item level and price — and the two tracks that matter run
    //
    //     Hero  1/6 = 305 · 2/6 = 308 · 3/6 = 311 · 4/6 = 315 · 5/6 = 318 · 6/6 = 321
    //     Myth  1/6 = 318 · 2/6 = 321 · 3/6 = 324 · 4/6 = 328 · 5/6 = 331 · 6/6 = 334
    //
    // at a flat 20 crests a step, in that track's own currency. Those item levels are the ones pinned
    // from the PTR sheet above, from an unrelated source, which is the check on the table.
    //
    // **The two-step overlap is the whole reason this figure is 80 and not 100.** A slot's crest cost
    // is discounted by its *high watermark*, an item level: any step landing at or below the mark is
    // free (`highWatermarkDiscounts`, `scaling: 0`). And the tracks overlap by two, so
    //
    //     Hero 6/6 = 321 = Myth 2/6
    //
    // which means capping a slot's Hero track — paid for in *Hero* crests, the plentiful ones — puts
    // the mark at 321 and makes the first Myth step free. So climbing a Mythic drop (318) to a roll's
    // payout (334) is five steps but only **four paid ones**: 4 × 20 = 80 Myth crests. That is Larias'
    // figure, and its "1,280 to cap 16 slots" is exactly 16 × 80. The guide is right, and it is right
    // for a reason worth writing down rather than rounded to.
    //
    // So 80 is a genuine **maximum**, and the figure only ever falls from it:
    //
    //     mark ≤ 321 (Myth untouched)      80   the most a roll can save
    //     mark = 324 (Myth 3/6)            60   ... and down by 20 a step from there
    //     mark = 331 (Myth 5/6)            20
    //     mark ≥ 334 (Myth 6/6)             0   nothing left to buy
    //
    // Note what is *not* on that list: a mark below 321 does not push the figure to 100. Arithmetically
    // it would — an unhelped slot pays all five steps — but nobody should ever be in that position,
    // because the fix is to take a Heroic item in that slot to Hero 6/6 and pay in Hero crests, which
    // fall out of running M+ and are the plentiful currency. Spending *Myth* crests on a step you can
    // have for Hero crests is simply a mistake, so pricing the roll as if you'd make it would credit
    // the token with rescuing you from bad play. `crestFreeTo` is that floor, and `crestSavingAt`
    // clamps to it. The Hero crests themselves are deliberately not modelled: they're cheap, they're
    // farmable on demand, and putting a second currency on an encounter card buys noise.
    //
    // A linked /simc carries the marks, so where there is one the app computes this instead of
    // assuming it; see `crestSavingAt` and `crestSavingRange` in model.js. `crests` below is only the
    // fallback for having nothing to compute from.
    //
    // Every other payout lands on the first step of a track, which is where a drop starts anyway,
    // so it saves no crests even though it is still a better item than the boss would have given.
    //
    // Cost does not vary by slot. Every Midnight step carries a single cost block at
    // `mask_inv_type: 0` — one price for every inventory type — so a two-hander, a ring and a helm
    // all climb at 20 a step. See "double slots" in the README for what that does and doesn't mean.
    rollReward: {
      mythic: {
        label: "Myth 6/6",
        ilvl: 334,
        crests: 80,
        crestKind: "Myth",
        crestFrom: 318,
        crestPerStep: 20,
        crestSteps: [318, 321, 324, 328, 331, 334],
        crestFreeTo: 321, // Hero 6/6, which is also Myth 2/6
      },
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
        // The rungs below the quoted one, and the key-slider indices that select them. Only the two
        // ends carry a track step, and only because the table above pins them: 305 is where Hero
        // starts (a Normal boss pays it) and 318 is where Myth starts (a Heroic boss pays it). The
        // three in between sit inside the overlap between two tracks — 308 is both Champion 6/6 and
        // a Hero step — so they stay item levels.
        //
        // No rung below the top saves a crest, for the same reason no raid difficulty below Mythic
        // does: they all land on the first step of a track, which is where the drop would have
        // started anyway. Only a Mythic boss hands the item over already finished.
        ladder: [
          { at: "M0", keys: [0], ilvl: 302, crests: 0, crestKind: "Champion" },
          {
            at: "+2–3",
            keys: [1],
            ilvl: 305,
            label: "Hero 1/6",
            crests: 0,
            crestKind: "Hero",
          },
          { at: "+4–5", keys: [2, 3], ilvl: 308, crests: 0, crestKind: "Hero" },
          { at: "+6", keys: [4], ilvl: 311, crests: 0, crestKind: "Hero" },
          { at: "+7–9", keys: [5, 6], ilvl: 315, crests: 0, crestKind: "Hero" },
          {
            at: "+10 or higher",
            keys: [7],
            ilvl: 318,
            label: "Myth 1/6",
            crests: 0,
            crestKind: "Myth",
          },
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
      raid: "1320", // Venomous Abyss — not 1317, the Tidebound Grotto world boss
      lastBosses: 2,
      badge: "Venomcursed 9/6",
      // What is true of these bosses at every difficulty is the cantrips, not the item level: 9/6 is
      // the Mythic payout alone, and it's the Heroic roll that guides actually recommend week to week.
      badgeAlt: "Cantrip items",
      ilvl: 344,
      note:
        "Its Mythic items are 9/6 (ilvl 344) with cantrip effects, a tier above anything else in " +
        "the game, and the reason most raiders bank a token for kill week instead of spending it here.",
      // Larias' 8/10 revision, and a reversal of the advice above rather than a footnote to it: at
      // current tuning a cantrip item is worth more to almost every spec than the 80 Myth crests a
      // Mythic roll saves you somewhere else, and the cantrips are on these items at every difficulty.
      // So the recommended weekly roll became these same bosses on Heroic — a small pool where every
      // item carries a cantrip, paying Myth 1/6 like any other Heroic boss. Both sentences are true
      // at once: roll them on Heroic most weeks, and hold a token for the Mythic kill.
      heroicNote:
        "The cantrip effects are on these items at every difficulty, so rolling here on Heroic is " +
        "the week-to-week play for most specs — a small pool where everything carries a cantrip, " +
        "still paying Myth 1/6. Guides rate that above the 80 crests a Mythic roll saves you elsewhere.",
    },
  },
};

// The season this build targets. Moved to 2 on 2026-08-11, the day 12.1 went live: the shipped
// database is Venomous Abyss and the new dungeon rotation, and the token economy the page prices
// with is Season 2's. Note that the raid itself opens on the 18th, so for pre-season week the page
// ranks content that is listed but not yet lootable — `seasonWeek` reports week 0 through that,
// which is what the week copy leans on to say so.
const ACTIVE = 2;

export const SEASON = SEASONS[ACTIVE];

/** Masthead / documentation label, e.g. "WoW S1 Midnight". */
export const SEASON_LABEL = `WoW S${SEASON.number} ${SEASON.expansion}`;

/** Full name of a season, spelled out — what a panel about it has to be headed with. */
export function seasonName(s) {
  return `${s.expansion} Season ${s.number}`;
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
 * The run of weeks in which taking a bonus-roll token costs you your Great Vault item.
 *
 * Returns null when the season never charges a vault slot for the token, so callers can drop the
 * sentence entirely rather than print a range with nothing behind it. `to` is null when the season
 * knows the trade starts but not when it stops — "from week N" is still worth saying, and inventing
 * an end week to make the phrasing tidy would be inventing data.
 *
 * Two places on the page describe this window in prose and they must not disagree, which is the
 * whole reason it's derived here rather than written out twice.
 *
 * @param {Season} season
 * @returns {{from: number, to: number|null}|null}
 */
export function tokenVaultWindow(season) {
  if (!season.tokenFromVault) return null;
  return {
    from: season.tokenVaultFrom || 1,
    to: season.tokenVaultWeeks || null,
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Which week of the season a moment falls in.
 *
 * The season describes itself in week numbers — the token comes out of a vault slot in weeks 2–7 —
 * and a week number is only worth printing next to which week it is now. That's a calendar question
 * nothing else in the app has a reason to hold, so it lives here, beside the window it answers.
 *
 * Week 0 is a state, not a floor: before the season opens, "it starts on the 18th" is the honest
 * thing to say, and clamping it to 1 would claim the season had begun. Null where the season has no
 * published calendar, so callers drop the sentence rather than invent a week for it.
 *
 * Counted from the US reset, which is the reset Larias' dates are written in. Other regions reset
 * later the same day, so for those hours this names a week the reader hasn't reached — an error of
 * one week for under a day, at the boundary, against a control the app has nowhere to source an
 * answer for. The report says which realm a character is on but not which schedule it resets on.
 *
 * @param {Season} season
 * @param {Date} [now]  Defaults to now; a parameter so this is testable and the caller isn't.
 * @returns {{week: number, opens: Date}|null}
 */
export function seasonWeek(season, now) {
  if (!season.week1) return null;
  const open = Date.parse(season.week1);
  if (!Number.isFinite(open)) return null;
  const at = (now || new Date()).getTime();
  return {
    week: at < open ? 0 : Math.floor((at - open) / WEEK_MS) + 1,
    opens: new Date(open),
  };
}

/**
 * The most recent weekly reset, which is when everything weekly stopped being true.
 *
 * A Great Vault is a weekly object: three options appear at reset and are replaced at the next one.
 * Nothing else in the app has a reason to know that, but the pasted `/simc` block describing those
 * options is stored indefinitely, so something has to be able to say when it expired.
 *
 * Counted off `week1` in sevens, so it inherits the same US-reset caveat as `seasonWeek` — for the
 * hours between the US reset and a later region's, this names a reset the reader hasn't had yet, and
 * a vault read just before theirs reads as expired a few hours early. The failure is a prompt to
 * re-paste, which is cheap; the opposite error prices a week's decision off last week's vault.
 *
 * Before the season opens this still answers, with the reset that began the pre-season week — which
 * is a real reset with a real vault behind it, so there is nothing to special-case.
 *
 * @param {Season} season
 * @param {Date} [now]
 * @returns {Date|null} null where the season publishes no calendar to count from.
 */
export function lastReset(season, now) {
  if (!season.week1) return null;
  const open = Date.parse(season.week1);
  if (!Number.isFinite(open)) return null;
  const at = (now || new Date()).getTime();
  const weeks = Math.floor((at - open) / WEEK_MS);
  return new Date(open + weeks * WEEK_MS);
}

/**
 * Where today sits against the token window — the one thing the two week sentences on the page are
 * really being asked.
 *
 * Split from its wording on purpose: the drawer and the vault banner both answer this and must not
 * answer it differently, exactly as they already share `tokenVaultWindow`. Null when either half is
 * missing (no trade to place, or no calendar to place it on), which is the same shape the rest of
 * the week copy degrades to.
 *
 * @param {Season} season
 * @param {Date} [now]
 * @returns {{week: number, opens: Date, trades: Date, state: "before"|"early"|"trade"|"free"}|null}
 *   `before` — the season hasn't opened. `early` — in season, but the token isn't in the vault yet.
 *   `trade` — inside the window, so the token costs you the item. `free` — past it, you get both.
 *   `trades` is the reset the window opens on, which is the date worth naming in the first two.
 */
export function tokenWeekNow(season, now) {
  const win = tokenVaultWindow(season),
    w = seasonWeek(season, now);
  if (!win || !w) return null;
  const state =
    !w.week || w.week < win.from
      ? w.week
        ? "early"
        : "before"
      : win.to && w.week > win.to
        ? "free"
        : "trade";
  return {
    week: w.week,
    opens: w.opens,
    trades: new Date(w.opens.getTime() + (win.from - 1) * WEEK_MS),
    state,
  };
}

/**
 * What a bonus roll on this kind of source, at this difficulty, would actually hand you.
 *
 * Returns null when the season doesn't promote rewards at all — a roll is just the drop, so the
 * drop's own item level is the honest answer and callers should use it. Otherwise it always returns
 * a Reward, falling back to a blank one for a difficulty it doesn't recognise: in a season that
 * promotes, "I can't tell which step" must not be mistaken for "no promotion", because the two
 * disagree about whether a copy you already own makes the roll redundant.
 *
 * For a dungeon the difficulty that matters is the key level, and where the report records one the
 * matching rung of the M+ ladder *is* the reward — same shape, same fields, resolved the same way.
 * A report that doesn't say falls back to the entry itself, which quotes the top rung; see the
 * comment on `mythic-plus` for why overstating is the safe direction there.
 *
 * @param {Season} season
 * @param {"raid"|"dungeon"} type
 * @param {string} [diffKey]  Canonical difficulty ("mythic", "heroic", …); ignored for dungeons.
 * @param {number|null} [keyLevel]  QE key-slider index the report was run at; dungeons only.
 * @returns {Reward|null}
 */
export function rewardOf(season, type, diffKey, keyLevel) {
  const table = season.rollReward;
  if (!table) return null;
  if (type === "dungeon") {
    const mp = table["mythic-plus"];
    if (!mp) return { label: "", ilvl: null };
    const rung =
      keyLevel == null
        ? null
        : (mp.ladder || []).find((k) => (k.keys || []).includes(keyLevel));
    // The ladder rides along on the resolved rung: the reward pane draws the whole thing, and it
    // still wants every rung even when the card is only quoting one of them.
    return rung ? { ...rung, label: rung.label || "", ladder: mp.ladder } : mp;
  }
  return table[String(diffKey)] || { label: "", ilvl: null };
}

/** `rewardOf` against the season this build targets. */
export function rollReward(type, diffKey, keyLevel) {
  return rewardOf(SEASON, type, diffKey, keyLevel);
}

/**
 * Has the encounter database moved to a season this build doesn't know about? True once
 * `npm run data` picks up a new season's content but ACTIVE above hasn't been bumped to match —
 * which is exactly when the token costs and the season label are about to be wrong.
 *
 * Compares the current raid list, not the season id. QE Live carried the same `seasonID` (34)
 * across Midnight's Season 1 and Season 2 boundary while swapping every raid underneath it, so an
 * id check would have sat silent through the one rollover it existed to catch. The raid list is
 * what upstream actually edits at a season boundary, so it is what this watches; the id is kept on
 * the season as a fallback for a season nobody recorded a raid list for.
 *
 * @param {import("./types.js").QEData|undefined} data  The generated database.
 */
export function seasonDrift(data) {
  if (!data) return false;
  if (SEASON.qeRaids && Array.isArray(data.currentRaids)) {
    return data.currentRaids.join() !== SEASON.qeRaids.join();
  }
  if (data.seasonId == null || SEASON.qeSeasonId == null) return false;
  return data.seasonId !== SEASON.qeSeasonId;
}
