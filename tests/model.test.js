import assert from "node:assert/strict";
import { test } from "node:test";
import { QE_DATA } from "../src/data.js";
import { specId } from "../src/loot.js";
import {
  activeLootSpec,
  baselineOf,
  buildGroups,
  crestSavingAt,
  diffKey,
  diffLabel,
  dv,
  finalBosses,
  fmt,
  hasPct,
  isDupe,
  qeIsModern,
  resolve,
  rollIlvlFor,
  rollScored,
  rollTopFor,
  simcLootSpec,
  unitOf,
  vaultChoice,
  vaultStatus,
  vaultTakeOf,
} from "../src/model.js";
import { lastReset, rollReward, SEASON } from "../src/season.js";
import { state } from "../src/store.js";

// A current raid + one of its bosses, pulled from the live database so the test
// adapts to data changes rather than hard-coding ids.
const RAID_ID = Number(QE_DATA.currentRaids[0]);
const RAID = QE_DATA.raids[String(RAID_ID)];
const ENC_ID = Number(Object.keys(RAID.bosses)[0]);

// A pool is the boss's whole loot table, not just what the report scored — the two synthetic items
// below land in it alongside everything else the encounter drops. The board's spec ("holy") is
// deliberately ambiguous, so nothing is filtered out by loot spec and the pool is the full table.
const TABLE = Object.keys(QE_DATA.items).filter((id) =>
  QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
).length;
const POOL = TABLE + 2;

// The board below sims its two items off a Mythic raid boss at DROP_ILVL. What a roll there hands
// back is the season's business, not this file's: Season 1 pays the drop itself, Season 2 promotes
// it to Myth 6/6. Tests about owning a copy are about the comparison, not about either number, so
// they measure against this rather than restating whichever season is active.
const DROP_ILVL = 639;
const PAYOUT = rollIlvlFor(rollReward("raid", "mythic"), DROP_ILVL);

/** A minimal Droptimizer board with two upgrades on the same boss. */
function makeBoard() {
  return {
    id: "t",
    key: "testkey",
    reportId: "r",
    player: "Foo",
    realm: "area-52",
    spec: "holy",
    source: "droptimizer",
    metric: "raw",
    baseline: 1000,
    results: [
      {
        item: 900001,
        inst: RAID_ID,
        enc: ENC_ID,
        diff: "mythic",
        level: 639,
        score: 10,
      },
      {
        item: 900002,
        inst: RAID_ID,
        enc: ENC_ID,
        diff: "mythic",
        level: 639,
        score: 20,
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
}

test("resolve maps a raid encounter to its boss name", () => {
  const info = resolve(RAID_ID, ENC_ID);
  assert.equal(info.type, "raid");
  assert.equal(info.name, RAID.bosses[String(ENC_ID)]);
  assert.equal(info.current, true);
});

test("buildGroups scores a pool as (Σ wanted ÷ pool size) ÷ token cost", () => {
  state.showAll = false;
  state.simc = {};
  const built = buildGroups(makeBoard());
  assert.equal(built.rows.length, 1);
  const row = built.rows[0];
  assert.equal(row.num, 30); // 10 + 20 wanted
  assert.ok(
    TABLE > 0,
    "the boss has a known loot table to dilute the pool with",
  );
  assert.equal(row.remaining, POOL); // the scored pair plus every other drop, at zero value
  assert.equal(row.cost, SEASON.tokenRaid); // raid cost comes from the season
  assert.equal(row.ev, 30 / POOL / SEASON.tokenRaid);
  assert.equal(row.nWant, 2); // only the two the report actually valued
});

test("a Rolled item leaves the pool and stops counting toward EV", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  b.overlay[`${RAID_ID}:${ENC_ID}:900002`] = "rolled"; // remove the 20-value item
  const row = buildGroups(b).rows[0];
  assert.equal(row.num, 10);
  assert.equal(row.remaining, POOL - 1);
  assert.equal(row.ev, 10 / (POOL - 1) / SEASON.tokenRaid);
});

test("a per-encounter override beats the season's token cost", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  b.tokenOverride[`${RAID_ID}:${ENC_ID}`] = 4;
  const row = buildGroups(b).rows[0];
  assert.equal(row.cost, 4);
  assert.equal(row.ev, 30 / POOL / 4);
});

/* ---------- what the roll actually pays out ---------- */

test("with no promotion the roll pays the drop's own item level", () => {
  assert.equal(rollIlvlFor(null, 639), 639);
  assert.equal(rollIlvlFor(null, 0), null); // report never said — don't pretend to know
});

test("a promoted roll pays its track's item level, or nothing until that level is known", () => {
  assert.equal(rollIlvlFor({ label: "Myth 6/6", ilvl: 652 }, 639), 652);
  assert.equal(rollIlvlFor({ label: "Myth 1/6", ilvl: null }, 639), null);
});

test("a copy you hold only dupes a roll it matches or beats", () => {
  assert.equal(isDupe(639, 639), true);
  assert.equal(isDupe(652, 639), true);
  assert.equal(isDupe(639, 652), false); // the promoted roll is still an upgrade
  assert.equal(isDupe(null, 639), false); // you don't hold one
  assert.equal(isDupe(639, null), false); // promoted by an unknown amount — guess Want, not Own
});

test("holding a copy at the roll's item level marks it Own and drops it from the numerator", () => {
  state.showAll = false;
  const b = makeBoard();
  state.simc = { testkey: { owned: { 900002: PAYOUT } } };
  const row = buildGroups(b).rows[0];
  const it = row.items.filter((x) => x.id === 900002)[0];
  assert.equal(
    it.rollIlvl,
    PAYOUT,
    "a dupe is measured against what the roll pays, which the season decides",
  );
  assert.equal(it.dupe, true);
  assert.equal(it.state, "own");
  assert.equal(row.num, 10); // only the item they don't already hold
  assert.equal(row.remaining, POOL); // an owned copy still dilutes the pool
});

test("holding a weaker copy leaves the item Want, tagged with what you hold", () => {
  state.showAll = false;
  const b = makeBoard();
  state.simc = { testkey: { owned: { 900002: PAYOUT - 9 } } };
  const it = buildGroups(b).rows[0].items.filter((x) => x.id === 900002)[0];
  assert.equal(it.ownedIlvl, PAYOUT - 9);
  assert.equal(it.dupe, false);
  assert.equal(it.state, "want");
  assert.equal(buildGroups(b).rows[0].num, 30);
});

/* ---------- end-of-raid encounters worth banking a token for ---------- */

test("the final bosses of a raid are the tail of its pull order", () => {
  assert.ok(RAID.order, "the current raid records a pull order to read");
  assert.deepEqual(finalBosses(RAID_ID, 2), RAID.order.slice(-2));
  assert.deepEqual(finalBosses(RAID_ID, 1), RAID.order.slice(-1));
});

// The reason `order` is carried through the data build at all. Journal encounter ids were assumed
// to ascend with pull order until Venomous Abyss, where they don't: the raid ends on Coiled Altar
// (2883), which sorts sixth of eight, so sorting by id badges Lost Explorers (2894) as the boss to
// bank a token for. That is the one piece of advice every guide leads with, so it is worth a test
// naming the raid rather than only the general rule above.
test("pull order and encounter-id order disagree, and pull order wins", () => {
  const abyss = QE_DATA.raids["1320"];
  if (!abyss?.order) return; // a later season may not ship this raid
  const byId = Object.keys(abyss.bosses).sort((a, c) => Number(a) - Number(c));
  assert.notDeepEqual(abyss.order.slice(-2), byId.slice(-2));
  assert.deepEqual(
    finalBosses(1320, 2).map((e) => abyss.bosses[e]),
    ["Coiled Altar", "Ula'tek"],
  );
});

test("asking for no final bosses, or for an unknown raid, names none", () => {
  assert.deepEqual(finalBosses(RAID_ID, 0), []);
  assert.deepEqual(finalBosses(-999, 2), []);
});

// `finalBosses` answers for any raid; only the season's named tier raid gets the badge. Season 2
// ranks a one-boss flex world boss alongside the tier raid, and "the last two bosses" of a one-boss
// raid is that boss — so without the gate the world boss wore the Venomcursed badge.
test("only the season's tier raid carries the end-of-raid badge", () => {
  const sp = SEASON.special;
  if (!sp?.raid) return; // a season with one raid needs no gate
  const others = QE_DATA.currentRaids.filter((id) => id !== String(sp.raid));
  assert.ok(others.length, "Season 2 ranks more than one raid");
  for (const id of others) {
    const bosses = Object.keys(QE_DATA.raids[id].bosses);
    for (const enc of bosses) {
      assert.equal(
        buildGroups(makeBoard()).rows.some(
          (r) => r.g.key === `${id}:${enc}` && r.g.special,
        ),
        false,
        `${QE_DATA.raids[id].name} is not the tier raid`,
      );
    }
  }
});

// A raid shorter than the window is all endgame rather than an error.
test("a raid with fewer bosses than asked for yields all of them", () => {
  const n = Object.keys(RAID.bosses).length;
  assert.equal(finalBosses(RAID_ID, n + 5).length, n);
});

/* ---------- the vault item you give up to roll ---------- */

/**
 * Put `ids` in this week's vault, as the /simc addon would report them.
 *
 * Stamped `at` now, because a vault is only this week's until the next reset and the app disowns one
 * it can't date. A fixture without the stamp is testing the expiry rule, not the trade — see the
 * expiry tests below, which build one deliberately.
 */
function withVault(ids) {
  state.simc = {
    testkey: {
      owned: {},
      at: new Date().toISOString(),
      vault: ids.map((id) => ({ name: `V${id}`, ilvl: 639, id })),
    },
  };
}

/* ---------- a vault is only this week's ----------
   Three options appear at the weekly reset and are gone at the next one, but the /simc paste
   describing them sits in localStorage forever. Undated, a Season 1 vault kept being offered as a
   live trade months later — three items from raids that aren't even current, each priced against
   this week's rolls. Only the vault half expires; owned gear and logged rolls don't. */

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Put `ids` in a vault last read at `at` — omit `at` for a paste from before the app dated them. */
function withVaultAt(ids, at) {
  withVault(ids);
  if (at) state.simc.testkey.at = at.toISOString();
  else delete state.simc.testkey.at;
}

test("a vault read since the last reset is still this week's", () => {
  state.showAll = false;
  withVaultAt([900002], new Date());
  const b = makeBoard();
  assert.equal(vaultStatus(b).stale, false);
  assert.ok(vaultChoice(b), "so there is still a trade to weigh");
});

test("a vault read before the last reset has expired", () => {
  state.showAll = false;
  const b = makeBoard();
  const reset = lastReset(SEASON);
  assert.ok(
    reset,
    "the active season publishes a calendar to count resets from",
  );
  withVaultAt([900002], new Date(reset.getTime() - 1000));
  assert.equal(vaultStatus(b).stale, true);
  assert.equal(vaultChoice(b), null, "an expired vault offers no trade");
});

test("an undated vault is treated as expired rather than as this week's", () => {
  state.showAll = false;
  withVaultAt([900002]);
  const b = makeBoard();
  assert.equal(vaultStatus(b).at, null);
  assert.equal(vaultStatus(b).stale, true);
  assert.equal(vaultChoice(b), null);
});

test("with no vault at all there is no state to report", () => {
  state.simc = {};
  assert.equal(vaultStatus(makeBoard()), null);
});

// The damage an expired vault could still do to the ranking, which is the reason this isn't purely
// a display concern: `vaultTake` marks an item Own, and an Own item drops out of the numerator.
test("an expired vault's pick stops being folded into the pools", () => {
  state.showAll = false;
  const b = makeBoard();
  b.vaultTake = 900002;

  withVaultAt([900002], new Date());
  assert.equal(vaultTakeOf(b), 900002);
  assert.equal(
    buildGroups(b).rows[0].num,
    10,
    "taken, so its 20 stops counting",
  );

  withVaultAt([900002], new Date(lastReset(SEASON).getTime() - 1000));
  assert.equal(vaultTakeOf(b), null);
  assert.equal(
    buildGroups(b).rows[0].num,
    30,
    "expired, so last week's pick isn't editing this week's pool",
  );
});

test("expiry is scoped to the vault, not to the rest of the paste", () => {
  state.showAll = false;
  withVaultAt([900002], new Date(lastReset(SEASON).getTime() - WEEK));
  state.simc.testkey.owned = { 900002: PAYOUT };
  const it = buildGroups(makeBoard()).rows[0].items.filter(
    (x) => x.id === 900002,
  )[0];
  assert.equal(
    it.state,
    "own",
    "gear you own doesn't stop being owned at a reset",
  );
});

test("with no vault imported there is no trade to weigh", () => {
  state.showAll = false;
  state.simc = {};
  assert.equal(vaultChoice(makeBoard()), null);
});

test("a vault item worth more than one roll's expectation says keep the item", () => {
  state.showAll = false;
  withVault([900002]); // the 20-value item, against 30/POOL per roll
  const vc = vaultChoice(makeBoard());
  assert.equal(vc.keep.id, 900002);
  assert.equal(vc.keep.score, 20);
  assert.equal(vc.perRoll, 30 / POOL);
  assert.equal(vc.verdict, "keep");
});

test("a vault of nothing you want says spend the token", () => {
  state.showAll = false;
  withVault([900003]); // never scored by the report
  const vc = vaultChoice(makeBoard());
  assert.equal(vc.keep.score, 0);
  assert.equal(
    vc.keep.scored,
    false,
    "unevaluated is not the same claim as worthless",
  );
  assert.equal(vc.verdict, "roll");
});

// Taking an item and spending the token it would have been are the two branches being compared.
// Pricing the roll against a board that has already taken one costs the roll its own alternative.
test("the roll side is priced as if nothing were taken from the vault", () => {
  state.showAll = false;
  withVault([900002]);
  const b = makeBoard();
  b.vaultTake = 900002;
  assert.equal(vaultChoice(b).perRoll, 30 / POOL);
});

// The asymmetry a one-week comparison hides: a roll takes an item out of the pool for good, while
// taking the vault item leaves it in there forever, counted and worth nothing.
test("taking a vault item is charged for the pool it permanently pollutes", () => {
  state.showAll = false;
  withVault([900002]);
  const vc = vaultChoice(makeBoard());
  assert.equal(
    vc.drag.amount,
    20 / POOL,
    "the numerator loses 20 over an unchanged pool",
  );
  assert.equal(
    vc.drag.isTop,
    true,
    "and it's the encounter the ranking would send you to",
  );
});

test("an item already out of the running drags nothing further", () => {
  state.showAll = false;
  withVault([900002]);
  const b = makeBoard();
  b.overlay[`${RAID_ID}:${ENC_ID}:900002`] = "rolled"; // gone from the pool already
  assert.equal(vaultChoice(b).drag, null);
});

test("a vault item that no live pool contains has nothing to drag", () => {
  state.showAll = false;
  withVault([900003]);
  assert.equal(vaultChoice(makeBoard()).drag, null);
});

// The score belongs to the boss's drop, the item belongs to the vault, and the two are routinely a
// track step apart — so the level the number was earned at travels with it.
test("a vault option carries the item level its score was simmed at", () => {
  state.showAll = false;
  withVault([900002]);
  const opt = vaultChoice(makeBoard()).options[0];
  assert.equal(opt.score, 20);
  assert.equal(opt.scoredIlvl, 639, "the report's level, not the vault's");
  assert.equal(opt.ilvl, 639);
});

test("the best vault option is the one the trade is measured against", () => {
  state.showAll = false;
  withVault([900001, 900002]);
  const vc = vaultChoice(makeBoard());
  assert.equal(vc.options.length, 2);
  assert.equal(vc.keep.id, 900002, "20 beats 10");
});

// Filler comes out of the loot table, not the report, so it carries no simmed drop level. What that
// means for owning one is the season's answer, not a fixed rule: where a roll hands you the drop,
// there is nothing to compare against and owning a copy must not be read as owning the reward;
// where the season promotes, the payout is known without a drop level and a better copy really is
// a dupe. Both are covered so a rollover can't quietly flip one into the other unnoticed.
test("a filler item's payout follows the season, not a drop level it hasn't got", () => {
  state.showAll = false;
  const b = makeBoard();
  const filler = Object.keys(QE_DATA.items).filter((id) =>
    QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
  )[0];
  state.simc = { testkey: { owned: { [filler]: 9999 } } };
  const it = buildGroups(b).rows[0].items.filter(
    (x) => String(x.id) === filler,
  )[0];
  assert.equal(it.lvl, 0, "the loot table carries no drop level");

  const reward = rollReward("raid", "mythic");
  assert.equal(it.rollIlvl, reward ? reward.ilvl : null);
  assert.equal(it.dupe, Boolean(reward?.ilvl));
});

/* ---------- QE reports: which field the value actually lives in ----------
   A QE result carries the same upgrade three ways. `rawDiff` is the HPS gained and `percDiff` is
   that gain as a percentage, both regardless of settings; `score` is whichever of the two the
   person running the report had selected, and QE defaults that to the percentage. So `score` on a
   typical report is a bare ratio, and a board that read it reported hundredths of an HPS. These
   fix the field the model reads and the baseline it recovers from the pair. */

/** A QE board whose results carry both metrics, as QE Live's upgrade report sends them. */
function makeQEBoard(over = {}) {
  const item = Number(
    Object.keys(QE_DATA.items).find((id) =>
      QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
    ),
  );
  return {
    id: "q",
    key: "qekey",
    reportId: "r",
    player: "Heals",
    realm: "area-52",
    spec: "holy",
    source: "qe",
    metric: "raw",
    // baseHPS of 10,000: a 250 HPS gain is 2.5% of it, a 100 HPS gain 1%.
    results: [
      {
        item,
        score: 0.025,
        rawDiff: 250,
        percDiff: 2.5,
        level: 272,
        dropDifficulty: 6,
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
    ...over,
  };
}

test("a QE result is valued by its HPS, not by the metric the report was saved under", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQEBoard();
  const it = buildGroups(b).rows[0].items.find((x) => x.score > 0);
  assert.equal(it.score, 250, "rawDiff, not the 0.025 sitting in `score`");
});

test("a QE report old enough to lack rawDiff still falls back to its score", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQEBoard();
  delete b.results[0].rawDiff;
  delete b.results[0].percDiff;
  b.results[0].score = 250;
  const it = buildGroups(b).rows[0].items.find((x) => x.score > 0);
  assert.equal(it.score, 250);
});

test("a QE baseline is recovered from the two metrics of the same upgrade", () => {
  const b = makeQEBoard();
  assert.equal(baselineOf(b), 10000);
  assert.equal(hasPct(b), true, "so the percentage toggle is offered");
  assert.equal(unitOf(b), "HPS");
  assert.equal(unitOf({ ...b, metric: "pct" }), "% HPS");
});

test("percentages scale off that baseline: 250 of 10,000 HPS reads as 2.5", () => {
  const b = makeQEBoard();
  assert.equal(dv(b, 250), "250");
  assert.equal(dv({ ...b, metric: "pct" }, 250), "2.5");
});

// An EV is a score over a dozen-item pool over a token cost, so in percentage mode it lands two
// orders of magnitude below the item scores it came from. On a real Midnight report that put every
// dungeon at "0.00" — a ranking rendered as a column of zeroes.
test("an EV too small for two decimals keeps two significant figures instead", () => {
  assert.equal(fmt(0.0014), "0.0014");
  assert.equal(fmt(0.0199), "0.02");
  assert.equal(fmt(0), "0", "a real zero still reads as zero");
  assert.equal(fmt(578), "578", "and the numbers that were fine are untouched");
  assert.equal(fmt(48.166666), "48.17");
});

test("a report with no usable pair offers no percentage rather than a wrong one", () => {
  const b = makeQEBoard();
  b.results[0].percDiff = 0; // a zero gain says nothing about the ratio
  assert.equal(baselineOf(b), 0);
  assert.equal(hasPct(b), false);
  assert.equal(dv(b, 250), "250", "and raw values are untouched");
});

/* ---------- QE difficulty is an index into QE's slider, not a rank ---------- */

test("a QE difficulty index resolves through QE's own table", () => {
  const b = makeQEBoard();
  assert.equal(diffLabel(b, 6), "Mythic");
  assert.equal(diffLabel(b, 4), "Heroic");
  assert.equal(diffLabel(b, 2), "Normal");
  assert.equal(diffLabel(b, 0), "Raid Finder");
});

// The old positional mapping read the board's difficulties best-first and named them off a rank
// list, so a report holding Normal and Mythic — with nothing in between — called Normal "Heroic",
// and the season's reward table was then asked about the wrong upgrade track.
test("a gap in a report's difficulties doesn't shift the labels below it", () => {
  const b = makeQEBoard();
  b.results = [
    { ...b.results[0], dropDifficulty: 6 },
    { ...b.results[0], dropDifficulty: 2 },
  ];
  assert.equal(diffLabel(b, 2), "Normal");
  assert.equal(diffKey(b, 2), "normal");
});

test("a maxed-out difficulty pays out on its own track, not one of its own", () => {
  const b = makeQEBoard();
  assert.equal(diffLabel(b, 7), "Mythic (Max)");
  assert.equal(diffKey(b, 7), "mythic");
  assert.equal(
    diffKey(b, 1),
    "lfr",
    "Raid Finder is keyed the way people say it",
  );
});

/* ---------- QE Live 12.1: the same index, a different slider ----------
   The 12.1 Upgrade Finder renumbered raid difficulty from eight values to four — the "(Max)" twins
   moved onto their own `dropType` axis — and dropped the ability to sim two difficulties at once.
   So the same `dropDifficulty` names a different difficulty either side of that release, and a
   Mythic report read on the old table came out as Normal, which then priced the roll off the Hero
   track instead of Myth. Reports live in localStorage and outlive the patch that made them, so both
   scales have to keep working, told apart by the `dropType` only 12.1 sends. */

/** A 12.1 QE board: three rows per item, and one raid difficulty rather than a spread. */
function makeQE121Board(over = {}) {
  const b = makeQEBoard();
  const row = b.results[0];
  // Mythic is 3 on the new slider and "Normal (Max)" on the old one, which is what made the bug
  // visible rather than merely wrong: the app confidently named a difficulty it had never been told.
  b.results = [
    {
      ...row,
      dropType: "drop",
      dropDifficulty: 3,
      level: 318,
      rawDiff: 100,
      percDiff: 1,
    },
    {
      ...row,
      dropType: "max",
      dropDifficulty: 3,
      level: 334,
      rawDiff: 200,
      percDiff: 2,
    },
    {
      ...row,
      dropType: "bonus",
      dropDifficulty: 3,
      level: 334,
      rawDiff: 250,
      percDiff: 2.5,
    },
  ];
  return { ...b, ...over };
}

test("a 12.1 report's difficulty is read off 12.1's slider, not Season 1's", () => {
  const b = makeQE121Board();
  assert.equal(qeIsModern(b), true);
  assert.equal(diffLabel(b, 3), "Mythic");
  assert.equal(diffKey(b, 3), "mythic");
  assert.equal(diffLabel(b, 2), "Heroic");
  assert.equal(diffLabel(b, 1), "Normal");
  assert.equal(diffLabel(b, 0), "Raid Finder");
});

test("a report from before 12.1 keeps being read off the slider it was written on", () => {
  const b = makeQEBoard();
  assert.equal(qeIsModern(b), false);
  assert.equal(diffLabel(b, 3), "Normal (Max)");
  assert.equal(diffLabel(b, 6), "Mythic");
});

test("a Mythic 12.1 report prices its rolls on the Myth track", () => {
  state.showAll = false;
  state.simc = {};
  const built = buildGroups(makeQE121Board());
  const row = built.rows.find((r) => r.g.type === "raid");
  assert.equal(built.selDiff, "3");
  assert.deepEqual(row.reward, rollReward("raid", "mythic"));
});

/* ---------- three rows, one item ----------
   A 12.1 report describes each item three times: the drop, the drop taken to the top of its own
   track, and the bonus roll taken to the top of *its* track. They are three different questions and
   the card asks two of them. Taking the best of the three — which is what "keep its best showing"
   did once the rows started arriving — lands on `bonus` nearly every time, and nearly is not a rule. */

test("a pool's score is the bonus row's, and its drop level the drop row's", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQE121Board();
  const row = buildGroups(b).rows.find((r) => r.g.type === "raid");
  const it = row.items.find((i) => i.score > 0);
  assert.equal(it.score, 250, "the bonus row is what a roll here is worth");
  assert.equal(it.scoreLvl, 334, "and the level that value was simmed at");
  assert.equal(it.lvl, 318, "while the drop level stays the drop's");
  assert.equal(rollScored(b), true);
});

test("the bonus row wins even when a lower row happens to score higher", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQE121Board();
  // Not a realistic sim, but the whole point is that the choice is a rule rather than an ordering:
  // Top Gear re-optimises the whole set per item level, so nothing guarantees monotonicity.
  b.results = b.results.map((r) =>
    r.dropType === "max" ? { ...r, rawDiff: 9000, percDiff: 90 } : r,
  );
  const row = buildGroups(b).rows.find((r) => r.g.type === "raid");
  const it = row.items.find((i) => i.score > 0);
  assert.equal(it.score, 250);
});

/* ---------- the level the scores belong to ----------
   QE's `bonus` row is the payout taken to the top of its track, so on any difficulty below Mythic
   the score and the payout are two different item levels: a Heroic roll hands over Myth 1/6 (318)
   and the report prices it at 334. The row carries both, because the card shows the score's level
   beside the score and the payout's everywhere the roll itself is described. */

/** The same report run on Heroic: the drop is lower, the `bonus` row is still the track's top. */
function heroic121Board() {
  const b = makeQE121Board();
  b.results = b.results.map((r) => ({
    ...r,
    dropDifficulty: 2,
    level: r.dropType === "drop" ? 315 : 334,
  }));
  return b;
}

test("a Heroic 12.1 report's scores belong to a higher item level than the roll pays", () => {
  state.showAll = false;
  state.simc = {};
  const row = buildGroups(heroic121Board()).rows.find(
    (r) => r.g.type === "raid",
  );
  assert.equal(row.reward.ilvl, 318, "what a Heroic roll hands over");
  assert.equal(row.scoreIlvl, 334, "what the scores were simmed at");
  const it = row.items.find((i) => i.score > 0);
  assert.equal(it.scoreLvl, 334);
  assert.equal(it.rollIlvl, 318);
});

/* ---------- and which of those two levels a dupe is judged against ----------
   The score beside a Heroic row is the payout after its track is paid for, so that is the copy the
   roll actually leads to and the one an item you already hold has to beat. Judging against the 318
   it arrives at instead marked a Hero 6/6 copy as a dupe of a roll four steps better than it. */

test("a roll's ceiling is the top of its track, never below what it hands over", () => {
  assert.equal(rollTopFor(318, 334), 334); // Heroic: arrives at 318, ends at 334
  assert.equal(rollTopFor(334, 334), 334); // Mythic: the two coincide
  assert.equal(rollTopFor(334, 318), 334); // a report that simmed low can't devalue the payout
  assert.equal(rollTopFor(318, null), 318); // no track-top claim: the payout stands alone
  assert.equal(rollTopFor(null, 334), null); // promoted by an unknown amount — still don't guess
});

test("a copy between a Heroic roll's payout and its track top is not a dupe", () => {
  state.showAll = false;
  const b = heroic121Board();
  const item = b.results[0].item;
  // Hero 6/6, which is also Myth 2/6: above the 318 the roll hands over, four steps below the 334
  // the report priced it at.
  state.simc = { qekey: { owned: { [item]: 321 } } };
  const it = buildGroups(b)
    .rows.find((r) => r.g.type === "raid")
    .items.find((x) => x.id === item);
  assert.equal(it.rollIlvl, 318, "what the roll hands over");
  assert.equal(
    it.rollTopIlvl,
    334,
    "where it ends up, which is what the score is for",
  );
  assert.equal(it.dupe, false);
  assert.equal(it.state, "want");
});

test("a copy at the Heroic roll's track top still dupes it", () => {
  state.showAll = false;
  const b = heroic121Board();
  const item = b.results[0].item;
  state.simc = { qekey: { owned: { [item]: 334 } } };
  const it = buildGroups(b)
    .rows.find((r) => r.g.type === "raid")
    .items.find((x) => x.id === item);
  assert.equal(it.dupe, true);
  assert.equal(it.state, "own");
});

// A Droptimizer sims the drop, so its score level is no claim about a track top and the payout is
// still the only honest thing to measure against. The ceiling must not leak across report formats.
test("a report that sims the drop judges dupes against the payout alone", () => {
  state.showAll = false;
  const b = makeBoard();
  state.simc = { testkey: { owned: { 900002: PAYOUT } } };
  const it = buildGroups(b).rows[0].items.find((x) => x.id === 900002);
  assert.equal(it.rollTopIlvl, it.rollIlvl);
  assert.equal(it.dupe, true);
});

test("a Mythic report's scores and payout are the same level, so the row quotes one number", () => {
  state.showAll = false;
  state.simc = {};
  const row = buildGroups(makeQE121Board()).rows.find(
    (r) => r.g.type === "raid",
  );
  assert.equal(row.scoreIlvl, row.reward.ilvl);
});

// A Droptimizer sims the drop, so the row's figure is the drop's level — which is what makes it
// safe for the card to keep showing the payout there instead. Nothing has been taken to a track top.
test("a Droptimizer's score level is the drop's, not a promoted one", () => {
  state.showAll = false;
  state.simc = {};
  const row = buildGroups(makeBoard()).rows[0];
  assert.equal(row.scoreIlvl, DROP_ILVL);
});

test("a report with no dropType still yields the one reading it has", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQEBoard();
  const row = buildGroups(b).rows.find((r) => r.g.type === "raid");
  const it = row.items.find((i) => i.score > 0);
  assert.equal(it.score, 250);
  assert.equal(it.lvl, 272);
  assert.equal(it.scoreLvl, 272, "one row, so both readings are that row");
  assert.equal(rollScored(b), false);
});

/* ---------- M+ key level ----------
   What a dungeon roll pays depends on the key, and until 12.1 no report said which key was run — so
   the app quoted the +10 ceiling for every dungeon on the page. A 12.1 report carries the key
   slider's index on every dungeon row, which is the join the season's ladder was already written
   against. */

/** A 12.1 QE board whose scored item drops in a current M+ dungeon, run at `keyLevel`. */
function makeDungeonBoard(keyLevel) {
  const dungeon = Number(QE_DATA.currentDungeons[0]);
  const item = Number(
    Object.keys(QE_DATA.items).find((id) =>
      QE_DATA.items[id].s.some((s) => s[0] === -1 && s[1] === dungeon),
    ),
  );
  const b = makeQE121Board();
  b.results = b.results.map((r) => ({
    ...r,
    item,
    dropDifficulty: keyLevel,
    dropLoc: "Dungeon",
  }));
  return b;
}

test("a dungeon roll is priced at the key the report was run at", () => {
  state.showAll = false;
  state.simc = {};
  const ladder = SEASON.rollReward["mythic-plus"].ladder;
  const top = ladder[ladder.length - 1];
  const low = ladder.find((k) => k.at === "+6");

  const built = buildGroups(makeDungeonBoard(low.keys[0]));
  const row = built.rows.find((r) => r.g.type === "dungeon");
  assert.equal(built.keyLevel, low.keys[0]);
  assert.equal(row.reward.ilvl, low.ilvl);
  assert.ok(
    low.ilvl < top.ilvl,
    "and that is below the ceiling it used to quote",
  );

  const high = buildGroups(makeDungeonBoard(top.keys[0]));
  assert.equal(
    high.rows.find((r) => r.g.type === "dungeon").reward.ilvl,
    top.ilvl,
  );
});

test("a report that records no key level still gets the ceiling quoted", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeDungeonBoard(7);
  // Strip what 12.1 added: a pre-12.1 report's dungeon difficulty indexed a different list
  // entirely, so reading it as a key would be a guess dressed as data.
  b.results = b.results.map((r) => {
    const bare = { ...r };
    delete bare.dropType;
    return bare;
  });
  const built = buildGroups(b);
  assert.equal(built.keyLevel, null);
  assert.equal(
    built.rows.find((r) => r.g.type === "dungeon").reward,
    SEASON.rollReward["mythic-plus"],
  );
});

/* ---------- gear the report was run in ---------- */

test("a QE report's own equipped gear marks a dupe without any /simc", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeQEBoard();
  const id = b.results[0].item;
  b.equipped = { [id]: 9999 };
  const it = buildGroups(b).rows[0].items.find((x) => x.id === id);
  assert.equal(it.ownedIlvl, 9999);
  assert.equal(it.state, "own");
});

test("where both sources know an item, the better copy wins", () => {
  state.showAll = false;
  const b = makeQEBoard();
  const id = b.results[0].item;
  b.equipped = { [id]: 260 };
  state.simc = { qekey: { owned: { [id]: 285 } } }; // a bag copy the report never saw
  const it = buildGroups(b).rows[0].items.find((x) => x.id === id);
  assert.equal(it.ownedIlvl, 285);
  state.simc = {};
});

/* ---------- which spec the game would actually loot you as ----------
   The report only knows the spec it was simmed as. A /simc knows the loot spec, and for a healer
   who loots as a DPS spec to dodge intellect trinkets the two differ — which changes the pool. */

test("a linked /simc's loot spec outranks the spec the report was simmed as", () => {
  const b = {
    ...makeQEBoard(),
    key: "lskey",
    spec: "Mistweaver Monk",
    lootSpec: null,
  };
  state.simc = { lskey: { lootSpec: "windwalker", owned: {} } };
  assert.equal(activeLootSpec(b), specId("windwalker"));
  state.simc = {};
  assert.equal(
    activeLootSpec(b),
    specId("mistweaver"),
    "and falls back to the report's",
  );
});

test("an explicit choice in the dropdown outranks both", () => {
  const b = { ...makeQEBoard(), key: "lskey", spec: "Mistweaver Monk" };
  state.simc = { lskey: { lootSpec: "windwalker", owned: {} } };
  b.lootSpec = specId("brewmaster");
  assert.equal(activeLootSpec(b), specId("brewmaster"));
  state.simc = {};
});

// A /simc left over from a different character must not silently re-point the pool at another
// class — the loot-spec dropdown only ever offers specs of this character's own class.
test("a loot spec from another class is ignored", () => {
  const b = {
    ...makeQEBoard(),
    key: "lskey",
    spec: "Mistweaver Monk",
    lootSpec: null,
  };
  state.simc = { lskey: { lootSpec: "frost", owned: {} } };
  assert.equal(activeLootSpec(b), specId("mistweaver"));
  state.simc = {};
});

// Regression: resolving the /simc loot spec globally instead of within the class silently dropped
// it for every name two classes share, which is half of them. A Holy Paladin's `loot_spec=holy`
// resolved to nothing and the pool quietly fell back to the report's spec.
test("an ambiguous /simc loot spec still resolves inside the report's class", () => {
  const b = {
    ...makeQEBoard(),
    key: "amb",
    spec: "Holy Paladin",
    lootSpec: null,
  };
  state.simc = { amb: { lootSpec: "holy", owned: {} } };
  assert.equal(simcLootSpec(b), specId("Holy Paladin"));
  assert.equal(activeLootSpec(b), specId("Holy Paladin"));
  state.simc = {};
});

test("a /simc loot spec naming a different spec of the same class is honoured", () => {
  const b = {
    ...makeQEBoard(),
    key: "amb",
    spec: "Holy Paladin",
    lootSpec: null,
  };
  state.simc = { amb: { lootSpec: "retribution", owned: {} } };
  assert.equal(activeLootSpec(b), specId("Retribution Paladin"));
  state.simc = {};
});

/* ---------- a tier token is worth the piece it buys ----------
   The boss drops the token; you trade it for one slot's tier piece. No tool scores the token, since
   a token has no stats — every report scores the piece, which is filed under the catalyst and so
   belongs to no encounter. Pooling the token without carrying that value across left the right item
   in the pool holding none of its worth, and on a tier boss the piece is routinely the best thing on
   the table: Vashnikt's Monk chest is a 4,904 HPS upgrade sitting in a pool of four. */

/**
 * Vashnikt, its chest token, the Monk chest that token is a voucher for, and one ordinary drop off
 * the same boss.
 *
 * The ordinary drop is load-bearing: an encounter only gets a row when the report scored something
 * that actually drops there, and the tier piece no longer does — it belongs to the catalyst. Without
 * it there is no Vashnikt row to look for a token in, which is a true fact about the model rather
 * than a quirk of the fixture.
 */
const TOKEN = { enc: 2882, id: 270927, piece: 271522, alsoDrops: 268205 };

/** A QE board that scored the tier piece, as a real report does. */
function makeTokenBoard(score) {
  return {
    id: "tk",
    key: "tkkey",
    reportId: "r",
    player: "Heals",
    realm: "area-52",
    spec: "Mistweaver Monk",
    source: "qe",
    metric: "raw",
    results: [
      {
        item: TOKEN.piece,
        dropType: "bonus",
        dropDifficulty: 3,
        level: 334,
        score,
        rawDiff: score,
        percDiff: 1,
      },
      {
        item: TOKEN.alsoDrops,
        dropType: "bonus",
        dropDifficulty: 3,
        level: 334,
        score: 100,
        rawDiff: 100,
        percDiff: 0.02,
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
}

/** The pooled token for Vashnikt, or null when this season doesn't ship it. */
function pooledToken(b) {
  const row = buildGroups(b).rows.find((r) => r.g.key === `1320:${TOKEN.enc}`);
  return row ? row.items.find((i) => i.id === TOKEN.id) || null : null;
}

test("a tier token takes the value of the piece it is traded for", (t) => {
  state.showAll = false;
  state.simc = {};
  if (!QE_DATA.items[TOKEN.id] || !QE_DATA.items[TOKEN.piece])
    return t.skip("a later season doesn't ship this token");
  const it = pooledToken(makeTokenBoard(4904));
  assert.ok(it, "the token is in the pool");
  assert.equal(it.score, 4904, "valued at the piece the report scored");
  assert.equal(it.givesId, TOKEN.piece);
  assert.equal(it.givesName, QE_DATA.items[TOKEN.piece].n);
});

// The whole point of the substitution: without it the token is filler, and filler in a pool of four
// is a third of the encounter's expected value thrown away.
test("the token's value reaches the encounter's EV", (t) => {
  state.showAll = false;
  state.simc = {};
  if (!QE_DATA.items[TOKEN.id])
    return t.skip("a later season doesn't ship this token");
  const rowOf = (b) =>
    buildGroups(b).rows.find((r) => r.g.key === `1320:${TOKEN.enc}`);
  const scored = rowOf(makeTokenBoard(4904));
  const zero = rowOf(makeTokenBoard(0));
  assert.equal(
    zero.num,
    100,
    "unscored, the token adds nothing beyond the boss's ordinary drop",
  );
  assert.equal(
    scored.num,
    5004,
    "scored, the piece's 4,904 arrives through the token",
  );
  assert.equal(
    scored.remaining,
    zero.remaining,
    "the substitution is a value, not an extra item in the pool",
  );
});

test("the piece itself stays out of the pool — only the token drops", (t) => {
  state.showAll = false;
  state.simc = {};
  if (!QE_DATA.items[TOKEN.piece])
    return t.skip("a later season doesn't ship this set");
  const row = buildGroups(makeTokenBoard(4904)).rows.find(
    (r) => r.g.key === `1320:${TOKEN.enc}`,
  );
  assert.equal(
    row.items.filter((i) => i.id === TOKEN.piece).length,
    0,
    "counting both would price the same reward twice",
  );
});

/* ---------- what a roll saves in crests, given a slot's high watermark ----------
   A step is free where the slot's watermark already covers it, so the saving is a function of the mark
   — but only downward. The interesting value isn't on the Myth track at all: Hero 6/6 is ilvl 321, the
   same as Myth 2/6, and reaching it costs Hero crests, which M+ hands out freely. So no sensible player
   ever pays Myth crests for that first step, the figure is clamped there, and 80 is a real maximum. */

test("an unknown watermark prices the maximum, which is the clamped figure", () => {
  const m = rollReward("raid", "mythic");
  assert.equal(crestSavingAt(m, null), 80);
  assert.equal(crestSavingAt(m, null), m.crests, "which is the quoted figure");
});

// The clamp, stated as the thing it prevents. Arithmetically a slot below the overlap pays all five
// steps and the roll would "save" 100 — but the fix for such a slot is Hero crests off a dungeon, not
// a bonus roll, so quoting 100 would credit the token with rescuing a misplay. It never exceeds 80.
test("a watermark under the overlap still prices no more than the maximum", () => {
  const m = rollReward("raid", "mythic");
  assert.equal(crestSavingAt(m, 0), 80, "an empty slot is not worth more");
  assert.equal(crestSavingAt(m, 308), 80); // Champion 6/6
  assert.equal(crestSavingAt(m, 318), 80); // the Mythic drop itself
  assert.equal(crestSavingAt(m, 321), 80); // Hero 6/6 = Myth 2/6, the clamp
  const marks = [0, 100, 250, 308, 311, 315, 318, 321];
  marks.forEach((k) => {
    assert.ok(
      crestSavingAt(m, k) <= m.crests,
      `mark ${k} must not exceed the quoted maximum`,
    );
  });
});

test("the saving falls a step at a time up the track, to nothing at the top", () => {
  const m = rollReward("raid", "mythic");
  assert.equal(crestSavingAt(m, 324), 60); // Myth 3/6
  assert.equal(crestSavingAt(m, 328), 40); // Myth 4/6
  assert.equal(crestSavingAt(m, 331), 20); // Myth 5/6
  assert.equal(crestSavingAt(m, 334), 0, "a capped slot saves no crests");
  assert.equal(crestSavingAt(m, 999), 0, "and cannot go negative");
});

// Larias' guide quotes 1,280 Myth crests to cap a character's 16 slots. That is the same arithmetic
// from the other end, so it is a free check on the per-slot figure against an outside source.
test("the per-slot figure agrees with the guide's whole-character total", () => {
  assert.equal(crestSavingAt(rollReward("raid", "mythic"), null) * 16, 1280);
});

test("a payout with no step table yields no figure rather than a wrong one", () => {
  assert.equal(crestSavingAt(rollReward("dungeon"), 300), null);
  assert.equal(crestSavingAt(null, 300), null);
});
