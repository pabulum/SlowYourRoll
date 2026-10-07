import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillEquipped,
  equippedBonus,
  equippedMap,
  loadSharedReport,
  parseDroptimizer,
} from "../src/reports.js";
import { detectSource, parseMarks, shareUrl } from "../src/share.js";
import { state } from "../src/store.js";

test("detectSource recognizes Raidbots links and long ids", () => {
  assert.deepEqual(
    detectSource("https://www.raidbots.com/simbot/report/aB3xYz12345"),
    { source: "droptimizer", id: "aB3xYz12345" },
  );
  assert.deepEqual(detectSource("abcdefghij0123456789XY"), {
    source: "droptimizer",
    id: "abcdefghij0123456789XY",
  });
});

test("detectSource recognizes QE report links and short codes", () => {
  assert.deepEqual(
    detectSource("https://questionablyepic.com/upgradereport/AbC123"),
    { source: "qe", id: "AbC123" },
  );
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
      players: [
        {
          name: "Foo",
          specialization: "Holy Priest",
          collected_data: { dps: { mean: 1000 } },
        },
      ],
      profilesets: {
        results: [
          { name: "1273/2607/mythic/12345/639/0/head///", mean: 1100 }, // +100
          { name: "1273/2607/mythic/12345/639/0/head///", mean: 1050 }, // dup, lower — ignored
          { name: "1273/2611/mythic/67890/639/0/neck///", mean: 900 }, // -100 -> 0
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

test("a share link carries the Rolled and Own marks, and reads back to the same overlay", () => {
  const overlay = {
    "1320:2895:250001": "rolled",
    "-1:1313:250224": "rolled",
    "1320:2883:250002": "own",
  };
  const url = shareUrl(
    /** @type {any} */ ({ reportId: "AbC123", overlay }),
    "https://example.com/",
  );
  assert.equal(
    url,
    "https://example.com/?report=AbC123" +
      "&rolled=-1:1313:250224,1320:2895:250001&own=1320:2883:250002",
  );
  assert.deepEqual(parseMarks(new URL(url).searchParams), overlay);
});

test("a share link with nothing marked is just the report", () => {
  assert.equal(
    shareUrl(/** @type {any} */ ({ reportId: "AbC123", overlay: {} }), "/"),
    "/?report=AbC123",
  );
});

test("parseMarks drops anything that isn't an overlay key", () => {
  const p = new URLSearchParams(
    "rolled=1320:2895:1,__proto__,1:2,a:b:c,1:2:3:4,&own=-1:1313:2",
  );
  assert.deepEqual(parseMarks(p), {
    "1320:2895:1": "rolled",
    "-1:1313:2": "own",
  });
});

test("opening a share link for a report you have merges its marks into your board", () => {
  const board = {
    id: "shared",
    reportId: "AbC123",
    overlay: { "1320:2895:1": "own", "1320:2895:2": "rolled" },
  };
  const saved = { ...state };
  Object.assign(state, { boards: [board], activeId: null, simc: {} });
  globalThis.location = /** @type {any} */ ({
    search: "?report=AbC123&rolled=1320:2895:1,1320:2895:3",
    pathname: "/",
    hash: "",
  });
  globalThis.history = /** @type {any} */ ({ replaceState() {} });
  try {
    loadSharedReport();
  } catch {
    // render() may not cope with this stub board; the overlay is merged before it runs.
  } finally {
    Object.assign(state, saved);
  }
  assert.deepEqual(board.overlay, {
    "1320:2895:1": "rolled", // the link wins where both speak
    "1320:2895:2": "rolled", // the recipient's own mark is kept
    "1320:2895:3": "rolled",
  });
});

// A QE report ships its equipped gear with each item's bonus ids as one colon-separated string. They
// ride along with the item level so a held copy's track can be named without a /simc at all.
test("a QE report's equipped gear keeps each copy's bonus ids", () => {
  const data = {
    equippedItems: [
      { id: 268266, level: 321, bonusIDS: "6652:13668:13334:12846" },
      { id: 268252, level: 334, bonusIDS: "6652:13668:13333:12854" },
      { id: 244573, level: 331, bonusIDS: "" },
    ],
  };
  assert.deepEqual(equippedMap(data), {
    268266: 321,
    268252: 334,
    244573: 331,
  });
  assert.deepEqual(equippedBonus(data), {
    268266: [6652, 13668, 13334, 12846],
    268252: [6652, 13668, 13333, 12854],
  });
});

// Boards saved before the equipped gear's bonus ids were kept can't name a held copy's track. The
// report is fixed once written, so it is simply read again for its gear — and nothing else on the
// board moves. Boards that already have the ids, and Droptimizer boards, are left alone.
test("a QE board saved without its gear's bonus ids gets them from the report", async (t) => {
  const old = {
    id: "o",
    source: "qe",
    reportId: "AbC123",
    equipped: { 268266: 321 },
    results: [{ item: 1 }],
    overlay: { "1:2:3": "rolled" },
  };
  const done = { id: "d", source: "qe", reportId: "Zz9", equippedBonus: {} };
  const dropt = { id: "r", source: "droptimizer", reportId: "long" };
  const saved = { ...state };
  Object.assign(state, { boards: [old, done, dropt], activeId: "o", simc: {} });
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(String(url));
    return {
      json: async () =>
        JSON.stringify({
          equippedItems: [
            { id: 268266, level: 321, bonusIDS: "6652:13668:13334:12846" },
          ],
        }),
    };
  });
  try {
    await backfillEquipped();
  } catch {
    // render() may not cope with these stub boards; the backfill has landed by then.
  } finally {
    Object.assign(state, saved);
  }
  assert.equal(asked.length, 1, "only the board missing them");
  assert.match(asked[0], /reportID=AbC123/);
  assert.deepEqual(old.equippedBonus, { 268266: [6652, 13668, 13334, 12846] });
  assert.deepEqual(old.results, [{ item: 1 }], "scores untouched");
  assert.deepEqual(old.overlay, { "1:2:3": "rolled" }, "marks untouched");
});

test("a report that can't be fetched leaves the board to try again next load", async (t) => {
  const old = { id: "o", source: "qe", reportId: "AbC123", equipped: {} };
  const saved = { ...state };
  Object.assign(state, { boards: [old], activeId: "o", simc: {} });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  try {
    await backfillEquipped();
  } finally {
    Object.assign(state, saved);
  }
  assert.equal(old.equippedBonus, undefined);
});
