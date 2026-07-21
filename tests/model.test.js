import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { state } from "../src/store.js";
import { resolve, buildGroups } from "../src/model.js";

// A current raid + one of its bosses, pulled from the live database so the test
// adapts to data changes rather than hard-coding ids.
const RAID_ID = Number(QE_DATA.currentRaids[0]);
const RAID = QE_DATA.raids[String(RAID_ID)];
const ENC_ID = Number(Object.keys(RAID.bosses)[0]);

/** A minimal Droptimizer board with two upgrades on the same boss. */
function makeBoard() {
  return {
    id: "t", key: "testkey", reportId: "r", player: "Foo", realm: "area-52", spec: "holy",
    source: "droptimizer", metric: "raw", baseline: 1000,
    results: [
      { item: 900001, inst: RAID_ID, enc: ENC_ID, diff: "mythic", level: 639, score: 10 },
      { item: 900002, inst: RAID_ID, enc: ENC_ID, diff: "mythic", level: 639, score: 20 },
    ],
    overlay: {}, tokenOverride: {}, vaultTake: null,
    tokenRaid: 1, tokenDungeon: 1, raidDiff: null,
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
  assert.equal(row.num, 30);      // 10 + 20 wanted
  assert.equal(row.remaining, 2); // both still in the pool
  assert.equal(row.cost, 1);
  assert.equal(row.ev, 15);       // 30 / 2 / 1
  assert.equal(row.nWant, 2);
});

test("a Rolled item leaves the pool and stops counting toward EV", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  b.overlay[RAID_ID + ":" + ENC_ID + ":900002"] = "rolled"; // remove the 20-value item
  const row = buildGroups(b).rows[0];
  assert.equal(row.num, 10);
  assert.equal(row.remaining, 1);
  assert.equal(row.ev, 10);       // 10 / 1 / 1
});

test("a higher token cost divides EV down", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  b.tokenOverride[RAID_ID + ":" + ENC_ID] = 2;
  const row = buildGroups(b).rows[0];
  assert.equal(row.cost, 2);
  assert.equal(row.ev, 7.5);      // 30 / 2 / 2
});
