import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSource, parseDroptimizer } from "../src/reports.js";

test("detectSource recognizes Raidbots links and long ids", () => {
  assert.deepEqual(detectSource("https://www.raidbots.com/simbot/report/aB3xYz12345"), { source: "droptimizer", id: "aB3xYz12345" });
  assert.deepEqual(detectSource("abcdefghij0123456789XY"), { source: "droptimizer", id: "abcdefghij0123456789XY" });
});

test("detectSource recognizes QE report links and short codes", () => {
  assert.deepEqual(detectSource("https://questionablyepic.com/upgradereport/AbC123"), { source: "qe", id: "AbC123" });
  assert.deepEqual(detectSource("AbC123"), { source: "qe", id: "AbC123" });
});

test("detectSource returns null on empty or junk input", () => {
  assert.equal(detectSource(""), null);
  assert.equal(detectSource("   "), null);
  assert.equal(detectSource("!!!"), null);
});

test("parseDroptimizer computes deltas, dedups, and clamps negatives to zero", () => {
  const data = {
    sim: {
      players: [{ name: "Foo", specialization: "Holy Priest", collected_data: { dps: { mean: 1000 } } }],
      profilesets: {
        results: [
          { name: "1273/2607/mythic/12345/639/0/head///", mean: 1100 }, // +100
          { name: "1273/2607/mythic/12345/639/0/head///", mean: 1050 }, // dup, lower — ignored
          { name: "1273/2611/mythic/67890/639/0/neck///", mean: 900 },  // -100 -> 0
        ],
      },
    },
    simbot: { player: "Foo", spec: "Holy Priest" },
  };
  const out = parseDroptimizer(data);
  assert.equal(out.baseline, 1000);
  assert.equal(out.idn.name, "Foo");
  assert.equal(out.results.length, 2);

  const up = out.results.find((r) => r.item === 12345);
  assert.equal(up.score, 100);
  assert.equal(up.rawDelta, 100);
  assert.equal(up.inst, 1273);
  assert.equal(up.enc, 2607);
  assert.equal(up.level, 639);

  const down = out.results.find((r) => r.item === 67890);
  assert.equal(down.score, 0);
});
