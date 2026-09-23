import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectSource,
  loadSharedReport,
  parseDroptimizer,
  parseMarks,
  shareUrl,
} from "../src/reports.js";
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
