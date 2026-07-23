import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { SEASON } from "../src/season.js";
import { state } from "../src/store.js";
import { resolve, buildGroups, rollIlvlFor, isDupe, vaultChoice } from "../src/model.js";

// A current raid + one of its bosses, pulled from the live database so the test
// adapts to data changes rather than hard-coding ids.
const RAID_ID = Number(QE_DATA.currentRaids[0]);
const RAID = QE_DATA.raids[String(RAID_ID)];
const ENC_ID = Number(Object.keys(RAID.bosses)[0]);

// A pool is the boss's whole loot table, not just what the report scored — the two synthetic items
// below land in it alongside everything else the encounter drops. The board's spec ("holy") is
// deliberately ambiguous, so nothing is filtered out by loot spec and the pool is the full table.
const TABLE = Object.keys(QE_DATA.items)
  .filter((id) => QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID)).length;
const POOL = TABLE + 2;

/** A minimal Droptimizer board with two upgrades on the same boss. */
function makeBoard() {
  return {
    id: "t", key: "testkey", reportId: "r", player: "Foo", realm: "area-52", spec: "holy",
    source: "droptimizer", metric: "raw", baseline: 1000,
    results: [
      { item: 900001, inst: RAID_ID, enc: ENC_ID, diff: "mythic", level: 639, score: 10 },
      { item: 900002, inst: RAID_ID, enc: ENC_ID, diff: "mythic", level: 639, score: 20 },
    ],
    overlay: {}, tokenOverride: {}, vaultTake: null, raidDiff: null,
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
  assert.equal(row.num, 30);        // 10 + 20 wanted
  assert.ok(TABLE > 0, "the boss has a known loot table to dilute the pool with");
  assert.equal(row.remaining, POOL); // the scored pair plus every other drop, at zero value
  assert.equal(row.cost, SEASON.tokenRaid);       // raid cost comes from the season
  assert.equal(row.ev, 30 / POOL / SEASON.tokenRaid);
  assert.equal(row.nWant, 2);       // only the two the report actually valued
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
  assert.equal(it.rollIlvl, 639, "Season 1 pays the drop, so that's what a dupe is measured against");
  assert.equal(it.dupe, true);
  assert.equal(it.state, "own");
  assert.equal(row.num, 10);          // only the item they don't already hold
  assert.equal(row.remaining, POOL);  // an owned copy still dilutes the pool
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

/* ---------- the vault item you give up to roll ---------- */

/** Put `ids` in this week's vault, as the /simc addon would report them. */
function withVault(ids) {
  state.simc = { testkey: { owned: {}, vault: ids.map((id) => ({ name: "V" + id, ilvl: 639, id })) } };
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
  assert.equal(vc.keep.scored, false, "unevaluated is not the same claim as worthless");
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
  const filler = Object.keys(QE_DATA.items)
    .filter((id) => QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID))[0];
  state.simc = { testkey: { owned: { [filler]: 9999 } } };
  const it = buildGroups(b).rows[0].items.filter((x) => String(x.id) === filler)[0];
  assert.equal(it.lvl, 0);
  assert.equal(it.rollIlvl, null);
  assert.equal(it.dupe, false);
});
