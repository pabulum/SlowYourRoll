import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { SEASON } from "../src/season.js";
import { state } from "../src/store.js";
import { specId } from "../src/loot.js";
import {
  resolve,
  buildGroups,
  rollIlvlFor,
  isDupe,
  vaultChoice,
  finalBosses,
  baselineOf,
  hasPct,
  unitOf,
  dv,
  diffLabel,
  diffKey,
  activeLootSpec,
} from "../src/model.js";

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
  b.overlay[RAID_ID + ":" + ENC_ID + ":900002"] = "rolled"; // remove the 20-value item
  const row = buildGroups(b).rows[0];
  assert.equal(row.num, 10);
  assert.equal(row.remaining, POOL - 1);
  assert.equal(row.ev, 10 / (POOL - 1) / SEASON.tokenRaid);
});

test("a per-encounter override beats the season's token cost", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  b.tokenOverride[RAID_ID + ":" + ENC_ID] = 4;
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
  state.simc = { testkey: { owned: { 900002: 639 } } };
  const row = buildGroups(b).rows[0];
  const it = row.items.filter((x) => x.id === 900002)[0];
  assert.equal(
    it.rollIlvl,
    639,
    "Season 1 pays the drop, so that's what a dupe is measured against",
  );
  assert.equal(it.dupe, true);
  assert.equal(it.state, "own");
  assert.equal(row.num, 10); // only the item they don't already hold
  assert.equal(row.remaining, POOL); // an owned copy still dilutes the pool
});

test("holding a weaker copy leaves the item Want, tagged with what you hold", () => {
  state.showAll = false;
  const b = makeBoard();
  state.simc = { testkey: { owned: { 900002: 630 } } };
  const it = buildGroups(b).rows[0].items.filter((x) => x.id === 900002)[0];
  assert.equal(it.ownedIlvl, 630);
  assert.equal(it.dupe, false);
  assert.equal(it.state, "want");
  assert.equal(buildGroups(b).rows[0].num, 30);
});

/* ---------- end-of-raid encounters worth banking a token for ---------- */

test("the final bosses of a raid are the tail of its encounter ids", () => {
  const ids = Object.keys(RAID.bosses).sort((a, c) => Number(a) - Number(c));
  assert.deepEqual(finalBosses(RAID_ID, 2), ids.slice(-2));
  assert.deepEqual(finalBosses(RAID_ID, 1), ids.slice(-1));
});

test("asking for no final bosses, or for an unknown raid, names none", () => {
  assert.deepEqual(finalBosses(RAID_ID, 0), []);
  assert.deepEqual(finalBosses(-999, 2), []);
});

// A raid shorter than the window is all endgame rather than an error.
test("a raid with fewer bosses than asked for yields all of them", () => {
  const n = Object.keys(RAID.bosses).length;
  assert.equal(finalBosses(RAID_ID, n + 5).length, n);
});

/* ---------- the vault item you give up to roll ---------- */

/** Put `ids` in this week's vault, as the /simc addon would report them. */
function withVault(ids) {
  state.simc = {
    testkey: {
      owned: {},
      vault: ids.map((id) => ({ name: "V" + id, ilvl: 639, id })),
    },
  };
}

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
  b.overlay[RAID_ID + ":" + ENC_ID + ":900002"] = "rolled"; // gone from the pool already
  assert.equal(vaultChoice(b).drag, null);
});

test("a vault item that no live pool contains has nothing to drag", () => {
  state.showAll = false;
  withVault([900003]);
  assert.equal(vaultChoice(makeBoard()).drag, null);
});

test("the best vault option is the one the trade is measured against", () => {
  state.showAll = false;
  withVault([900001, 900002]);
  const vc = vaultChoice(makeBoard());
  assert.equal(vc.options.length, 2);
  assert.equal(vc.keep.id, 900002, "20 beats 10");
});

// Filler comes out of the loot table, not the report, so it has no drop level to compare against.
// Owning one must not be read as owning the roll's reward.
test("an item the report never scored is not auto-owned on item level alone", () => {
  state.showAll = false;
  const b = makeBoard();
  const filler = Object.keys(QE_DATA.items).filter((id) =>
    QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
  )[0];
  state.simc = { testkey: { owned: { [filler]: 9999 } } };
  const it = buildGroups(b).rows[0].items.filter(
    (x) => String(x.id) === filler,
  )[0];
  assert.equal(it.lvl, 0);
  assert.equal(it.rollIlvl, null);
  assert.equal(it.dupe, false);
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
