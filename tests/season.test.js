import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEASONS,
  rewardOf,
  tokenVaultWindow,
  seasonWeek,
  tokenWeekNow,
} from "../src/season.js";

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
    const win = tokenVaultWindow(s);
    if (!s.tokenFromVault) {
      assert.equal(win, null, "Season " + n + " has no trade to describe");
      return;
    }
    assert.ok(
      s.tokenVaultWeeks > 0,
      "Season " + n + " needs the week the trade stops",
    );
    assert.ok(win.from >= 1 && win.from <= win.to, "Season " + n + " window");
  });
});

// Blizzard's 2026-07-31 season post withholds the Voidcore from the opening vault: it first appears
// on August 25, the second week. Guides written before that date plan a week 1 roll. If this ever
// reverts, the two sentences render.js builds off the window revert with it.
test("Season 2's token window opens in week 2, not week 1", () => {
  assert.deepEqual(tokenVaultWindow(SEASONS[2]), { from: 2, to: 7 });
});

/* ---------- the season calendar ---------- */

// Larias' 8/5 week-by-week dates every week of the season. If the anchor ever moves, these are the
// dates that have to move with it — the whole point of the field is that the app and that guide
// agree on which week it is.
test("the season's weeks land on the dates the week-by-week guide gives them", () => {
  const s2 = SEASONS[2];
  const on = (d) => seasonWeek(s2, new Date(d)).week;
  assert.equal(on("2026-08-11T16:00:00Z"), 0, "pre-season week");
  assert.equal(on("2026-08-18T16:00:00Z"), 1, "week 1, August 18");
  assert.equal(on("2026-08-25T16:00:00Z"), 2, "week 2, August 25");
  assert.equal(on("2026-09-01T16:00:00Z"), 3, "week 3, September 1");
  assert.equal(on("2026-09-08T16:00:00Z"), 4, "week 4, September 8");
  assert.equal(on("2026-09-15T16:00:00Z"), 5, "week 5, September 15");
});

// Week 0 is a state, not a clamp: before the season opens, the honest sentence is the date it opens
// on. Rounding it up to week 1 would have the pane claim the season had started.
test("a moment before the season opens is week 0, not week 1", () => {
  const s2 = SEASONS[2];
  assert.equal(seasonWeek(s2, new Date("2026-08-18T14:59:00Z")).week, 0);
  assert.equal(seasonWeek(s2, new Date("2026-08-18T15:00:00Z")).week, 1);
});

test("a season with no published calendar has no week rather than a guessed one", () => {
  assert.equal(seasonWeek(SEASONS[1], new Date("2026-08-25T16:00:00Z")), null);
  assert.equal(
    tokenWeekNow(SEASONS[1], new Date("2026-08-25T16:00:00Z")),
    null,
  );
});

// The two sentences on the page that place today against the window read off this one state, so a
// wrong boundary here is a page that contradicts itself rather than a page that's merely wrong.
test("the token window's state follows the week it's asked about", () => {
  const s2 = SEASONS[2];
  const at = (d) => tokenWeekNow(s2, new Date(d)).state;
  assert.equal(at("2026-08-11T16:00:00Z"), "before"); // season hasn't opened
  assert.equal(at("2026-08-18T16:00:00Z"), "early"); // week 1, no token in the vault
  assert.equal(at("2026-08-25T16:00:00Z"), "trade"); // week 2, the window opens
  assert.equal(at("2026-09-29T16:00:00Z"), "trade"); // week 7, its last week
  assert.equal(at("2026-10-06T16:00:00Z"), "free"); // week 8, a free weekly reward
});

// The date the window opens is quoted in the pane while it's still ahead of the reader, so it has to
// be the reset of `tokenVaultFrom` and not week 1's.
test("the window opens on the reset of the week the season says it does", () => {
  const s2 = SEASONS[2];
  const w = tokenWeekNow(s2, new Date("2026-08-12T16:00:00Z"));
  assert.equal(w.opens.toISOString(), "2026-08-18T15:00:00.000Z");
  assert.equal(w.trades.toISOString(), "2026-08-25T15:00:00.000Z");
  assert.equal(seasonWeek(s2, w.trades).week, tokenVaultWindow(s2).from);
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
