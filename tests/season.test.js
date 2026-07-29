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

// The 12.1 PTR item levels, kept here so a change to the sheet has to be a change to the tests too.
// Midnight's tracks are six steps and overlap by two, so a track's first step is four steps above
// the one below it — the arithmetic every figure in the table has to satisfy.
test("Season 2 pays out at the item levels the 12.1 PTR publishes", () => {
  const s2 = SEASONS[2];
  assert.equal(rewardOf(s2, "raid", "mythic").ilvl, 334); // Myth 6/6
  assert.equal(rewardOf(s2, "raid", "heroic").ilvl, 318); // Myth 1/6
  assert.equal(rewardOf(s2, "raid", "normal").ilvl, 305); // Hero 1/6
  assert.equal(rewardOf(s2, "raid", "lfr").ilvl, 292); // Champion 1/6
  assert.equal(rewardOf(s2, "dungeon").ilvl, 318); // Myth 1/6, at +10 or higher
});

// A Mythic boss and a dungeon cost the same single token, which is only worth saying because the
// two payouts are five upgrade steps apart. That gap is the season's whole argument.
test("the Mythic payout stands five upgrade steps above the dungeon one", () => {
  const s2 = SEASONS[2];
  assert.ok(
    rewardOf(s2, "raid", "mythic").ilvl > rewardOf(s2, "dungeon").ilvl,
    "a Mythic boss must out-pay a dungeon for the same token",
  );
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

// The tier the ranking can't see: three steps past the Mythic payout, and the reason a token gets
// banked for kill week. Pinned like every other PTR figure.
test("the end-of-raid tier out-levels the season's best ordinary payout", () => {
  const s2 = SEASONS[2];
  assert.equal(s2.special.ilvl, 344); // Venomcursed 9/6
  assert.ok(s2.special.ilvl > rewardOf(s2, "raid", "mythic").ilvl);
});

// The app quotes the top of the M+ ladder everywhere, because no report says which key you run.
// If the two ever part company the pane would be documenting a payout the ranking doesn't use.
test("the M+ ladder tops out at exactly the payout the app quotes", () => {
  const mp = rewardOf(SEASONS[2], "dungeon");
  const top = mp.ladder[mp.ladder.length - 1];
  assert.equal(top.ilvl, mp.ilvl);
  assert.equal(top.label, mp.label);
});

test("the M+ ladder climbs, so the quoted figure is a ceiling and not a middle", () => {
  const rungs = rewardOf(SEASONS[2], "dungeon").ladder;
  assert.ok(rungs.length > 1, "a one-rung ladder isn't one");
  rungs.forEach((k, i) => {
    assert.ok(k.at, "every rung says which keys pay it");
    if (i) assert.ok(k.ilvl > rungs[i - 1].ilvl, "rung " + i + " is no higher");
  });
});

// A rung is only named where the season's own table pins that item level to a track step. Naming
// the rest would be guessing which of two overlapping tracks a number belongs to.
test("a named ladder rung agrees with the difficulty that pays the same item level", () => {
  const s2 = SEASONS[2];
  const named = rewardOf(s2, "dungeon").ladder.filter((k) => k.label);
  assert.equal(named.length, 2, "only the two ends are named");
  const byIlvl = {};
  Object.keys(s2.rollReward).forEach((d) => {
    const r = s2.rollReward[d];
    byIlvl[r.ilvl] = r.label;
  });
  named.forEach((k) => {
    assert.equal(k.label, byIlvl[k.ilvl], k.at + " is labelled off the table");
  });
});

test("a season that buys the token with a vault slot says for how long", () => {
  Object.keys(SEASONS).forEach((n) => {
    const s = SEASONS[n];
    if (!s.tokenFromVault) return;
    assert.ok(
      s.tokenVaultWeeks > 0,
      "Season " + n + " needs the week the trade stops",
    );
  });
});

test("every reward carries a label and an item level slot", () => {
  Object.keys(SEASONS).forEach((n) => {
    const table = SEASONS[n].rollReward;
    if (!table) return;
    Object.keys(table).forEach((d) => {
      const r = table[d];
      assert.ok(r.label, "Season " + n + " " + d + " needs a display label");
      assert.ok(
        r.ilvl === null || typeof r.ilvl === "number",
        "Season " + n + " " + d + " ilvl",
      );
    });
  });
});
