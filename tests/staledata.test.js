// What happens on the first day of a new season, before anyone reruns `npm run data`.
//
// The report itself (a Droptimizer especially) carries the instance, encounter, difficulty, item
// and ilvl inline, so a next-season raid is rankable from the report alone. What must not happen is
// the app quietly dropping those rows because the shipped encounter database has never heard of
// them. These tests pin the degrade path: unknown-but-plausible sources survive and are flagged;
// sources that genuinely can't be bonus-rolled stay filtered out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { SEASON } from "../src/season.js";
import { state } from "../src/store.js";
import { resolve, buildGroups } from "../src/model.js";

// Ids chosen to be absent from any real database: Blizzard instance ids are ~4 digits.
const FUTURE_RAID = 999901;
const FUTURE_BOSS = 999801;
const FUTURE_DUNGEON = 999701;

/** A Droptimizer board whose drops come from a raid this build has never heard of. */
function futureBoard() {
  return {
    id: "t", key: "futurekey", reportId: "r", player: "Foo", realm: "area-52", spec: "holy",
    source: "droptimizer", metric: "raw", baseline: 1000,
    results: [
      { item: 900001, inst: FUTURE_RAID, enc: FUTURE_BOSS, diff: "mythic", level: 700, score: 10 },
      { item: 900002, inst: FUTURE_RAID, enc: FUTURE_BOSS, diff: "mythic", level: 700, score: 20 },
    ],
    overlay: {}, tokenOverride: {}, vaultTake: null, raidDiff: null,
  };
}

test("an unknown raid resolves to a flagged placeholder instead of vanishing", () => {
  const info = resolve(FUTURE_RAID, FUTURE_BOSS);
  assert.ok(info, "a future raid must resolve to something rankable");
  assert.equal(info.type, "raid");
  assert.equal(info.unknown, true);
  assert.equal(info.current, true, "unknown content is assumed current, not filtered away");
  assert.match(info.name, /999801/, "the placeholder names the encounter id so it can be looked up");
});

test("an unknown M+ dungeon resolves to a flagged placeholder", () => {
  const info = resolve(-1, FUTURE_DUNGEON);
  assert.ok(info);
  assert.equal(info.type, "dungeon");
  assert.equal(info.unknown, true);
  assert.equal(info.current, true);
});

test("sources that can't be bonus-rolled stay filtered out, unflagged", () => {
  // QE's negative sentinel instances: crafted, reputation, timewalking, PvP.
  assert.equal(resolve(-4, 1), null, "crafted gear is not a roll source");
  assert.equal(resolve(-12, 1), null, "reputation gear is not a roll source");

  // Instances the data build saw in item sources but deliberately ignored (world bosses,
  // leveling drops, catch-up vendors). Dropping these must not look like staleness.
  const ignored = QE_DATA.ignoredInstances || [];
  assert.ok(ignored.length, "the generated database should record its ignored instances");
  assert.equal(resolve(Number(ignored[0]), 1), null);
});

test("a raid's non-encounter drops are filtered out, not mistaken for staleness", () => {
  // QE files trash/catalyst loot under encounter 999 and world drops under a negative encounter,
  // both inside a real raid instance. Neither drops from a boss. Upstream lists 999 in a raid's
  // boss map only sometimes, so resolving it by name would make a ranked "Voidspire · Voidspire"
  // row appear and disappear with an upstream typo.
  const raidId = Number(QE_DATA.currentRaids[0]);
  assert.equal(resolve(raidId, 999), null, "trash & catalyst loot is not a roll source");
  assert.equal(resolve(raidId, -78), null, "world drops filed against a tier are not a roll source");

  state.showAll = false;
  state.simc = {};
  const b = futureBoard();
  b.results = [{ item: 900001, inst: raidId, enc: 999, diff: "mythic", level: 700, score: 10 }];
  const built = buildGroups(b);
  assert.deepEqual(built.rows, [], "no phantom row");
  assert.deepEqual(built.unknown, [], "and no warning — this was dropped knowingly");
});

test("a known raid with an unrecognised boss keeps the raid name but is flagged", () => {
  const raidId = Number(QE_DATA.currentRaids[0]);
  const info = resolve(raidId, FUTURE_BOSS);
  assert.equal(info.name, QE_DATA.raids[String(raidId)].name);
  assert.equal(info.unknown, true);
});

test("a next-season report still ranks, and reports what it couldn't identify", () => {
  state.showAll = false; // the default view: no "show older content" escape hatch
  state.simc = {};
  const built = buildGroups(futureBoard());

  assert.equal(built.rows.length, 1, "the unknown boss must still produce a ranked row");
  const row = built.rows[0];
  assert.equal(row.num, 30);
  assert.equal(row.remaining, 2);
  assert.equal(row.cost, SEASON.tokenRaid);
  assert.equal(row.ev, 30 / 2 / SEASON.tokenRaid);

  assert.equal(built.unknown.length, 1, "the staleness banner needs something to report");
  assert.match(built.unknown[0], /999901/, "the warning identifies the unknown raid");
});

test("known current content produces no staleness warning", () => {
  state.showAll = false;
  state.simc = {};
  const raidId = Number(QE_DATA.currentRaids[0]);
  const encId = Number(Object.keys(QE_DATA.raids[String(raidId)].bosses)[0]);
  const b = futureBoard();
  b.results = [{ item: 900001, inst: raidId, enc: encId, diff: "mythic", level: 700, score: 10 }];
  const built = buildGroups(b);
  assert.equal(built.rows.length, 1);
  assert.deepEqual(built.unknown, []);
});

test("unknown sources hidden by a filter don't raise a warning", () => {
  // An unknown source at a difficulty other than the selected one is off-screen; warning about it
  // would be noise. Only what the user can actually see counts.
  state.showAll = false;
  state.simc = {};
  const raidId = Number(QE_DATA.currentRaids[0]);
  const encId = Number(Object.keys(QE_DATA.raids[String(raidId)].bosses)[0]);
  const b = futureBoard();
  b.results = [
    { item: 900001, inst: raidId, enc: encId, diff: "mythic", level: 700, score: 10 },
    { item: 900002, inst: FUTURE_RAID, enc: FUTURE_BOSS, diff: "normal", level: 650, score: 20 },
  ];
  b.raidDiff = "mythic";
  const built = buildGroups(b);
  assert.equal(built.rows.length, 1, "only the mythic row shows");
  assert.deepEqual(built.unknown, [], "the filtered-out normal row raises nothing");
});
