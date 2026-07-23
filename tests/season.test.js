import { test } from "node:test";
import assert from "node:assert/strict";
import { SEASONS, rewardOf } from "../src/season.js";

test("a Season 1 roll hands you the drop, so there is no reward to look up", () => {
  assert.equal(rewardOf(SEASONS[1], "raid", "mythic"), null);
  assert.equal(rewardOf(SEASONS[1], "dungeon"), null);
});

test("a Season 2 roll pays out at the track the vault would have given", () => {
  const s2 = SEASONS[2];
  assert.equal(rewardOf(s2, "raid", "mythic").label, "Myth 6/6");
  assert.equal(rewardOf(s2, "raid", "heroic").label, "Myth 1/6");
  assert.equal(rewardOf(s2, "raid", "normal").label, "Hero 1/6");
});

test("a Season 2 dungeon pays the first Myth step, whatever difficulty is selected", () => {
  assert.equal(rewardOf(SEASONS[2], "dungeon", "mythic").label, "Myth 1/6");
  assert.equal(rewardOf(SEASONS[2], "dungeon").label, "Myth 1/6");
});

// The distinction the whole dupe check rests on: in a promoting season, a difficulty we can't place
// still means "promoted", and must not fall back to the season-1 answer of "you get the drop".
test("an unrecognised difficulty in a promoting season is unknown, not unpromoted", () => {
  const r = rewardOf(SEASONS[2], "raid", "diff 7");
  assert.notEqual(r, null);
  assert.equal(r.ilvl, null);
  assert.equal(r.label, "");
});

// The crest yield only exists where the payout is above a track's first step. Anywhere else the
// roll still hands you a better item than the boss would, but not one you'd have paid crests for.
test("only the fully-upgraded payout banks crests", () => {
  const s2 = SEASONS[2];
  assert.equal(rewardOf(s2, "raid", "mythic").crests, 80);
  assert.equal(rewardOf(s2, "raid", "heroic").crests, 0);
  assert.equal(rewardOf(s2, "dungeon").crests, 0);
});

test("an unrecognised difficulty banks no crests rather than guessing a figure", () => {
  assert.equal(rewardOf(SEASONS[2], "raid", "diff 7").crests, undefined);
});

test("only a season with an end-of-raid tier describes one", () => {
  assert.equal(SEASONS[1].special, null);
  assert.equal(SEASONS[2].special.lastBosses, 2);
  assert.ok(SEASONS[2].special.badge && SEASONS[2].special.note);
});

test("every reward carries a label and an item level slot", () => {
  Object.keys(SEASONS).forEach((n) => {
    const table = SEASONS[n].rollReward;
    if (!table) return;
    Object.keys(table).forEach((d) => {
      const r = table[d];
      assert.ok(r.label, "Season " + n + " " + d + " needs a display label");
      assert.ok(r.ilvl === null || typeof r.ilvl === "number", "Season " + n + " " + d + " ilvl");
    });
  });
});
