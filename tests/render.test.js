// Rendering, against the page the browser actually loads.
//
// These are deliberately shallow on wording and specific about structure. What they're for is the
// class of failure that unit tests on pure functions can't see: an element id that no longer
// exists, a fragment that never reaches the DOM, a name from a report arriving as markup. The one
// thing asserted in detail is escaping, because that is the property the whole rendering layer is
// built to guarantee.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { state } from "../src/store.js";
import { render, renderSeason } from "../src/render.js";
import {
  SEASON,
  REWARD_SEASON,
  REWARDS_LIVE,
  seasonName,
  tokenWeekNow,
} from "../src/season.js";
import { loadPage } from "./page.js";

const RAID_ID = Number(QE_DATA.currentRaids[0]);
const RAID = QE_DATA.raids[String(RAID_ID)];
const ENC_ID = Number(Object.keys(RAID.bosses)[0]);
const BOSS = RAID.bosses[String(ENC_ID)];

/** A Droptimizer board with two upgrades on one boss, as tests/model.test.js builds it. */
function makeBoard(over = {}) {
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
    fetchedAt: "2026-07-20T00:00:00Z",
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
    ...over,
  };
}

/** Render `boards` into a fresh copy of index.html and hand back the document. */
function renderWith(boards, extra = {}) {
  const doc = loadPage();
  Object.assign(
    state,
    {
      boards,
      activeId: boards.length ? boards[0].id : null,
      showAll: false,
      simc: {},
    },
    extra,
  );
  render();
  return doc;
}

test("with nothing loaded the page invites a report and hides the controls", () => {
  const doc = renderWith([]);
  assert.equal(doc.getElementById("controls").hasAttribute("hidden"), true);
  assert.equal(doc.getElementById("listHead").hasAttribute("hidden"), true);
  assert.match(doc.getElementById("sources").textContent, /Paste a QE Live/);
});

test("a loaded report renders one card per encounter, with its EV", () => {
  const doc = renderWith([makeBoard()]);
  const cards = doc.querySelectorAll("#sources .card");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute("data-key"), RAID_ID + ":" + ENC_ID);
  assert.match(
    cards[0].textContent,
    new RegExp(BOSS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(doc.getElementById("controls").hasAttribute("hidden"), false);
});

test("the verdict names the encounter the ranking sends you to", () => {
  const doc = renderWith([makeBoard()]);
  const target = doc.querySelector("#verdict .target");
  assert.ok(target, "the verdict panel rendered");
  assert.match(
    target.textContent,
    new RegExp(BOSS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("with no upgrades anywhere the verdict says hold the token instead of ranking nothing", () => {
  const doc = renderWith([
    makeBoard({
      results: [
        {
          item: 900001,
          inst: RAID_ID,
          enc: ENC_ID,
          diff: "mythic",
          level: 639,
          score: 0,
        },
      ],
    }),
  ]);
  assert.match(doc.getElementById("verdict").textContent, /hold your token/);
});

test("every item in the pool gets a row, and each row a state button", () => {
  const doc = renderWith([makeBoard()]);
  const rows = doc.querySelectorAll("#sources .item");
  assert.ok(
    rows.length >= 2,
    "the two scored items plus the rest of the loot table",
  );
  const cycles = doc.querySelectorAll('#sources [data-act="cycle"]');
  assert.ok(cycles.length > 0);
  assert.match(cycles[0].textContent, /Want|Own|Rolled/);
});

test("an item marked Rolled renders in that state", () => {
  const b = makeBoard();
  b.overlay[RAID_ID + ":" + ENC_ID + ":900002"] = "rolled";
  const doc = renderWith([b]);
  const row = doc.querySelector('#sources .item[data-id="900002"]');
  assert.ok(row);
  assert.match(row.getAttribute("class"), /st-rolled/);
});

// The whole reason src/html.js exists. Item names come from a third-party database and character
// names from a pasted report; neither is text this app wrote.
test("a hostile item name renders as text, not as markup", () => {
  const b = makeBoard();
  const doc = renderWith([b], {
    simc: {
      testkey: {
        owned: {},
        at: new Date().toISOString(),
        vault: [
          { id: 900001, ilvl: 639, name: "<img src=x onerror=alert(1)>" },
        ],
      },
    },
  });
  assert.equal(doc.querySelectorAll("#vaultPanel img").length, 0);
  assert.match(
    doc.getElementById("vaultPanel").textContent,
    /<img src=x onerror=alert\(1\)>/,
  );
});

test("a hostile character name renders as text in the report picker", () => {
  const doc = renderWith([makeBoard({ player: "<script>alert(1)</script>" })]);
  assert.equal(doc.querySelectorAll("#boardBtn script").length, 0);
  assert.match(
    doc.getElementById("boardBtn").textContent,
    /<script>alert\(1\)<\/script>/,
  );
});

// A Season 1 vault sat in localStorage for months, offered every week as if it were live: three
// items from raids that aren't current, each priced against this week's rolls. The panel now says
// which week it is describing, and offers to be rid of it.
test("an expired vault is a notice rather than a list of things to take", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      testkey: {
        owned: {},
        at: "2026-01-01T00:00:00Z",
        vault: [{ id: 900002, ilvl: 639, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel");
  assert.equal(
    panel.querySelectorAll("[data-vault]").length,
    0,
    "nothing left to take",
  );
  assert.ok(panel.querySelector('[data-act="clearvault"]'), "but a way out");
  assert.doesNotMatch(panel.textContent, /if you leave it/);
});

test("the vault panel prices the choice both ways and offers to take it", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      testkey: {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 639, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel");
  assert.match(panel.textContent, /if you leave it/);
  assert.match(panel.textContent, /if you take it/);
  assert.equal(
    panel.querySelector('[data-vault="900002"]').textContent.trim(),
    "Take this",
  );
});

// A vault reward and the boss's drop are rarely the same item level, and the score on screen is the
// report's, which only ever simmed the drop. Real case: a QE report simmed at ilvl 289 beside a
// vault offering 279 of the same item.
test("the vault names the item level its score was simmed at when it isn't the one on offer", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      testkey: {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 652, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel").textContent;
  assert.match(panel, /scored at ilvl 639/);
  assert.match(panel, /your vault offers ilvl 652/);
});

test("a vault item scored at the level it's offered at is quoted without qualification", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      testkey: {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 639, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel").textContent;
  assert.doesNotMatch(panel, /scored at ilvl/);
  // And the suppressed branch leaves nothing behind: a bare 0 is a value the templating renders.
  assert.match(panel, /ilvl 639(?!\d)/);
});

// QE sends dateCreated as "2026 - 7 - 29", which Date refuses; the masthead used to print it raw.
test("a QE report's own date format reaches the masthead as a date", () => {
  const doc = renderWith([
    makeBoard({ source: "qe", fetchedAt: "2026 - 7 - 29" }),
  ]);
  const badge = doc.getElementById("specBadge").textContent;
  assert.match(badge, /QE Live · simmed \S/);
  assert.doesNotMatch(badge, /2026/);
});

test("with no vault imported the panel renders nothing at all", () => {
  const doc = renderWith([makeBoard()]);
  assert.equal(doc.getElementById("vaultPanel").innerHTML, "");
});

test("a report the database can't identify is ranked and the banner says so", (t) => {
  t.mock.method(console, "warn", () => {}); // the maintainer's copy of the banner; expected here
  const doc = renderWith([
    makeBoard({
      results: [
        {
          item: 900001,
          inst: 99999,
          enc: 12345,
          diff: "mythic",
          level: 700,
          score: 50,
        },
      ],
    }),
  ]);
  assert.equal(doc.getElementById("dataNote").hasAttribute("hidden"), false);
  assert.match(doc.getElementById("dataNote").textContent, /item data yet/);
  assert.equal(
    doc.querySelectorAll("#sources .card").length,
    1,
    "still ranked, not dropped",
  );
});

test("known content raises no staleness banner", () => {
  const doc = renderWith([makeBoard()]);
  assert.equal(doc.getElementById("dataNote").hasAttribute("hidden"), true);
});

test("two reports for one character list both in the picker; one report disables it", () => {
  const solo = renderWith([makeBoard()]);
  assert.equal(solo.getElementById("boardBtn").disabled, true);

  const doc = renderWith([
    makeBoard(),
    makeBoard({ id: "t2", key: "testkey2", spec: "discipline" }),
  ]);
  assert.equal(doc.querySelectorAll("#boardMenu .popt").length, 2);
  assert.equal(doc.getElementById("boardBtn").disabled, false);
});

test("the season copy fills in from src/season.js rather than the markup", () => {
  const doc = loadPage();
  renderSeason();
  assert.match(doc.getElementById("seasonLabel").textContent, /^WoW S\d+ /);
  assert.ok(doc.getElementById("tokenNote").textContent.length > 0);
});

// Every render passes through closeBoardMenu, so no state change can leave the menu open over
// content that has since changed underneath it.
test("rendering closes the report picker", () => {
  const doc = renderWith([
    makeBoard(),
    makeBoard({ id: "t2", key: "testkey2", spec: "discipline" }),
  ]);
  doc.getElementById("boardMenu").hidden = false;
  render();
  assert.equal(doc.getElementById("boardMenu").hasAttribute("hidden"), true);
  assert.equal(
    doc.getElementById("boardBtn").getAttribute("aria-expanded"),
    "false",
  );
});

// One of the two places this file asserts wording, and for the same reason as the escaping tests:
// the verb is the claim, not the decoration. No bonus roll pays crests out — it hands the item over
// already upgraded, so the figure is crests you never spend. Quoted as a yield instead, a reader
// goes looking for a currency drop that isn't coming, or counts it twice against the crests they're
// already farming that week. The figure also has to survive on a *collapsed* card, since that's the
// one term the EV column beside it can't account for.
test("a card presents its crest figure as a saving, without being expanded", () => {
  const doc = renderWith([makeBoard()]);
  const meta = doc.querySelector("#sources .card .card-head .meta");
  const save = meta.querySelector(".crest-save");
  assert.ok(save, "the crest figure is in the collapsed card's summary line");
  assert.match(save.textContent, /saves/);
  assert.match(save.textContent, /80 Myth crests/);
});

/* ---------- is the crest figure assumed, or computed from your gear? ----------
   The saving is the climb from a Mythic drop to the payout, minus any step the slot's high watermark
   already covers, so it is a function of that mark and not a constant. With no /simc the season's
   baseline stands and has to be labelled as an assumption; with one it is computed per slot, and the
   answer can legitimately come out *above* the baseline — a slot short of the track overlap pays all
   five steps. Both directions are asserted, because hedging a computed number and presenting an
   assumed one as computed are both misreadings a reader would act on. */

/** An element's text with runs of whitespace collapsed, so prose assertions survive line reflow. */
function words(el) {
  return el.textContent.replace(/\s+/g, " ").trim();
}

/** `makeBoard`'s character, with per-slot high watermarks linked. */
function withMarks(marks) {
  return {
    simc: {
      testkey: {
        owned: {},
        watermarks: marks,
        at: new Date().toISOString(),
        vault: [],
      },
    },
  };
}

test("with no /simc linked the figure is the maximum, and says what reaching it takes", () => {
  const doc = renderWith([makeBoard()]);
  assert.match(
    words(doc.querySelector("#sources .card .crest-save")),
    /up to 80 Myth crests/,
  );
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /most it can save/);
  // The actionable half: the maximum is only reached if you buy the overlap step with the cheaper
  // track's crests. A reader told "80" without that could sit at a lower mark and never see it.
  assert.match(note, /take a lower-difficulty item in that slot to ilvl 321/);
  assert.doesNotMatch(note, /Computed from/);
});

// The clamp, through the UI. Every mark here is below ilvl 321 where the Hero and Myth tracks overlap,
// so arithmetically no slot has its free step and the climb is five paid ones. It must still read 80:
// reaching 321 costs Hero crests off a dungeon, not Myth crests, so a roll is never worth more than
// the guides' figure and the page must not invent a number above it. Real values, off a 12.1 export
// whose best slot is 308.
test("a /simc under the track overlap is still capped at the maximum", () => {
  const marks = [298, 298, 289, 289, 308, 289, 292, 305, 266, 279];
  const doc = renderWith([makeBoard()], withMarks(marks));
  const save = words(doc.querySelector("#sources .card .crest-save"));
  assert.match(save, /saves 80 Myth crests/);
  assert.doesNotMatch(save, /100/, "a roll never rescues a misplay");
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /Computed from your/);
  assert.match(
    note,
    new RegExp("every one of your " + marks.length + " slots"),
  );
});

// Hero capped everywhere reaches the same answer by the other route, so these two must agree. If they
// ever diverge, the clamp has stopped applying to one of them.
test("a /simc capped on the Hero track computes the same maximum", () => {
  const doc = renderWith([makeBoard()], withMarks([321, 321, 321]));
  assert.match(
    words(doc.querySelector("#sources .card .crest-save")),
    /saves 80 Myth crests/,
  );
});

// Slots in different states can't be collapsed to one number, because a roll lands in one of them and
// which is unknowable. The range is the honest answer, and it has to say why it stays a range — and
// its top must be the maximum, never above it.
test("a /simc with slots in mixed states gives a range and says why", () => {
  const doc = renderWith([makeBoard()], withMarks([300, 321, 324, 334]));
  assert.match(
    words(doc.querySelector("#sources .card .crest-save")),
    /saves 0–80 Myth crests/,
  );
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /between 0 and 80/);
  // It must say it can't name the slots, rather than quietly not naming them: a reader who sees a
  // range will otherwise assume the app knows which is which, and act on a mapping never established.
  assert.match(note, /isn’t something a .*pins down reliably/);
});

/* ---------- the reward pane ---------- */

test("the reward pane documents its own season, whatever season the app is pricing", () => {
  const doc = renderWith([]);
  const head = doc.getElementById("rewardTitle").textContent;
  assert.match(head, new RegExp(seasonName(REWARD_SEASON)));
  assert.match(doc.getElementById("rewardBtn").textContent, /^S\d+ rewards$/);
});

// The pane is a preview for as long as ACTIVE lags the season it describes, and a reader taking a
// number off it has to know which of the two they're looking at.
test("the pane says whether the ranking behind it is playing by these rules", () => {
  const doc = renderWith([]);
  const state1 = doc.querySelector("#rewardBody .rwd-state");
  assert.ok(state1, "the state line renders");
  if (REWARDS_LIVE) {
    assert.match(state1.getAttribute("class"), /\blive\b/);
    assert.match(state1.textContent, /already using/);
  } else {
    assert.match(state1.textContent, /Not live yet/);
    assert.match(state1.textContent, new RegExp(seasonName(SEASON)));
  }
});

test("every payout in the season's table reaches the pane with its item level", () => {
  const doc = renderWith([]);
  const body = doc.getElementById("rewardBody").textContent;
  const table = REWARD_SEASON.rollReward || {};
  Object.keys(table).forEach((d) => {
    const r = table[d];
    if (r.ilvl != null) assert.match(body, new RegExp("\\b" + r.ilvl + "\\b"));
    if (r.label) assert.match(body, new RegExp(r.label.replace("/", "/")));
  });
});

test("the M+ ladder is on screen, since the ranking only ever quotes its top rung", () => {
  const doc = renderWith([]);
  const mp = (REWARD_SEASON.rollReward || {})["mythic-plus"];
  const rungs = (mp && mp.ladder) || [];
  assert.ok(rungs.length, "the season carries a ladder to render");
  const rows = [...doc.querySelectorAll("#rewardBody .rwd")]
    .map((t) => t.textContent)
    .join(" ");
  rungs.forEach((k) => {
    assert.match(rows, new RegExp("\\b" + k.ilvl + "\\b"));
  });
});

// The pane's own statement of the figure, read off the season rather than hard-coded — the number
// is a PTR figure and will move. What's pinned is that the pane leads with it and frames it as a
// saving; see the card test above for why the verb is worth a test at all.
test("the pane leads its crest section with what a roll saves you", () => {
  const doc = renderWith([]);
  const fig = doc.querySelector("#rewardBody .rwd-figure");
  assert.ok(fig, "the saving is a figure in its own right, not a clause");
  const crests = ((REWARD_SEASON.rollReward || {}).mythic || {}).crests;
  assert.ok(crests, "the season has a saving to state");
  assert.match(fig.textContent, new RegExp("\\b" + crests + "\\b"));
  assert.match(fig.textContent, /saved/);
});

// The pane's one live connection to the page behind it: the row you're actually being ranked at.
test("the pane marks the difficulty the board is ranked at, and only that one", () => {
  const doc = renderWith([makeBoard()]);
  const here = doc.querySelectorAll("#rewardBody .rwd tr.here");
  assert.equal(here.length, 1);
  assert.match(here[0].textContent, /Mythic raid boss/);
  assert.match(here[0].textContent, /your raid diff/);
});

test("with no report loaded no row claims to be yours", () => {
  const doc = renderWith([]);
  assert.equal(doc.querySelectorAll("#rewardBody .rwd tr.here").length, 0);
});

// The pane's other live line: which week it is, against the window it has just described in the
// abstract. Asserted against the state rather than a sentence, so this doesn't start failing on the
// day the season moves on a week.
test("the pane places today against the window it just described", () => {
  const doc = renderWith([]);
  const now = tokenWeekNow(REWARD_SEASON);
  const line = doc.querySelector("#rewardBody .rwd-now");
  if (!now) {
    assert.equal(line, null, "with no calendar, the pane claims nothing");
    return;
  }
  assert.ok(line, "the week line renders");
  if (now.state === "before")
    assert.match(line.textContent, new RegExp(seasonName(REWARD_SEASON)));
  else assert.match(line.textContent, new RegExp("week " + now.week + "\\b"));
});

// Every week-by-week guide is keyed to the US reset dates, so a reset has to read the same on the
// page wherever it's opened. Formatted here in UTC independently: if render ever falls back to the
// reader's zone, a machine east of London renders the next day and this catches it.
test("a reset date is written the way the guides that date the season write it", () => {
  const now = tokenWeekNow(REWARD_SEASON);
  if (!now || (now.state !== "before" && now.state !== "early")) return;
  const txt = renderWith([]).querySelector("#rewardBody .rwd-now").textContent;
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  assert.match(txt, new RegExp(fmt.format(now.trades)));
});

test("the legend links into the pane in both seasons", () => {
  const doc = renderWith([]);
  const link = doc.querySelector('#rewardLink [data-act="rewards"]');
  assert.ok(link, "the legend carries a way in");
  assert.ok(link.textContent.trim().length > 0);
});
