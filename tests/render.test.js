// Rendering, against the page the browser actually loads.
//
// These are deliberately shallow on wording and specific about structure. What they're for is the
// class of failure that unit tests on pure functions can't see: an element id that no longer
// exists, a fragment that never reaches the DOM, a name from a report arriving as markup. The one
// thing asserted in detail is escaping, because that is the property the whole rendering layer is
// built to guarantee.

import assert from "node:assert/strict";
import { test } from "node:test";
import { QE_DATA } from "../src/data.js";
import { finalBosses } from "../src/model.js";
import { render, renderSeason } from "../src/render.js";
import {
  REWARD_SEASON,
  REWARDS_LIVE,
  SEASON,
  seasonName,
  tokenWeekNow,
} from "../src/season.js";
import { state } from "../src/store.js";
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
  assert.equal(cards[0].getAttribute("data-key"), `${RAID_ID}:${ENC_ID}`);
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
  b.overlay[`${RAID_ID}:${ENC_ID}:900002`] = "rolled";
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
      "foo~area52~": {
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
      "foo~area52~": {
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
      "foo~area52~": {
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

// A vault reward and the level a report scored it at are rarely the same, and a score from outside
// the report's range is not a number about the item on the table. Real case: a Heroic 9-boss vault
// slot paying Myth 1/6 (318) for an item the report only scored from its Mythic drop (324) up.
test("a vault option the report never priced at the offered level isn't given a number", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      "foo~area52~": {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 652, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel").textContent;
  assert.match(panel, /never scored it this low/);
  assert.match(panel, /only scored from ilvl 639 up/);
  assert.doesNotMatch(
    panel,
    /20 DPS guaranteed/,
    "the bonus row must not stand in for it",
  );
});

// The tier that does the work. A vault slot lands between two levels the report actually simmed, so
// the value is read off the line joining them rather than off a row for a different item level.
test("a vault option between two scored levels is read between them", () => {
  const b = makeBoard();
  b.results = [
    {
      item: 900002,
      inst: RAID_ID,
      enc: ENC_ID,
      diff: "mythic",
      level: 311,
      score: 10,
    },
    {
      item: 900002,
      inst: RAID_ID,
      enc: ENC_ID,
      diff: "mythic",
      level: 321,
      score: 20,
    },
  ];
  const doc = renderWith([b], {
    simc: {
      "foo~area52~": {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 318, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel").textContent;
  assert.match(panel, /17 DPS guaranteed/, "10 + 0.7 x (20 - 10)");
  assert.match(panel, /read between the report’s 311\s+and 321/);
});

test("a vault item scored at the level it's offered at is quoted without qualification", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      "foo~area52~": {
        owned: {},
        at: new Date().toISOString(),
        vault: [{ id: 900002, ilvl: 639, name: "V900002" }],
      },
    },
  });
  const panel = doc.getElementById("vaultPanel").textContent;
  assert.doesNotMatch(panel, /estimated between|never scored it/);
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

/* ---------- the item level a score belongs to ----------
   A 12.1 QE report scores the bonus roll as QE's own "Upgraded Bonus Rolls" panel does: the payout
   taken to the top of its track. So a Heroic boss's +11,053 is ilvl 334 while the roll hands the
   item over at 318, and the row printing 318 beside it — which it used to — describes an item
   nobody is being offered, and builds the Wowhead card from the wrong stats. Asserted through the
   DOM because the coupling is between two cells of one row, which no unit test on either sees. */

/** A 12.1 QE board on Heroic: scores at the top of the Myth track, a roll that pays its first step. */
function makeQEHeroicBoard(over = {}) {
  const item = Number(
    Object.keys(QE_DATA.items).find((id) =>
      QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
    ),
  );
  const row = { item, dropDifficulty: 2, score: 0.033 };
  return {
    id: "q",
    key: "qekey",
    reportId: "r",
    player: "Heals",
    realm: "area-52",
    spec: "holy",
    source: "qe",
    metric: "raw",
    results: [
      { ...row, dropType: "drop", level: 315, rawDiff: 7118, percDiff: 2.122 },
      { ...row, dropType: "max", level: 321, rawDiff: 8216, percDiff: 2.449 },
      {
        ...row,
        dropType: "bonus",
        level: 334,
        rawDiff: 11053,
        percDiff: 3.294,
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
    ...over,
  };
}

test("a scored row shows the item level its score was simmed at, not the one the roll pays", () => {
  const doc = renderWith([makeQEHeroicBoard()]);
  const scored = [...doc.querySelectorAll("#sources .card .item")].find((el) =>
    /11,053/.test(el.textContent),
  );
  assert.ok(scored, "the bonus row's value is the one on the card");
  // Both numbers, payout first: the roll hands over 318 and the score beside it is worth 334.
  assert.equal(words(scored.querySelector(".ilvl")), "318→334");
  assert.equal(words(scored.querySelector(".ilvl .from")), "318");
  assert.match(
    scored.querySelector(".ilvl .promoted").getAttribute("title"),
    /hands it over at ilvl 318 \(Myth 1\/6\)/,
  );
  // Wowhead rolls an item's stats from the level it's given, so the card has to agree with the score.
  assert.match(
    scored.querySelector(".iname a").getAttribute("data-wowhead"),
    /ilvl=334/,
  );
});

test("every row on the card reads at that level, so a pool quotes one item level", () => {
  const doc = renderWith([makeQEHeroicBoard()]);
  const levels = new Set(
    [...doc.querySelectorAll("#sources .card .item .ilvl")].map(words),
  );
  assert.deepEqual([...levels], ["318→334"], "fillers included");
});

test("the card says which of the report's figures the scores are", () => {
  const doc = renderWith([makeQEHeroicBoard()]);
  const note = words(doc.querySelector("#sources .card .swap-note"));
  assert.match(note, /Upgraded Bonus Rolls/);
  assert.match(note, /pays out at Myth 1\/6 — ilvl 318/);
  assert.match(note, /ilvl 334/);
  assert.match(note, /Droptimizer/);
});

/* ---------- a badge that quotes an item level is a claim about this roll ----------
   The season's end-of-raid rewards are Mythic-only: the same bosses on Heroic pay Myth 1/6 like any
   other Heroic boss, five upgrade steps under the badge. What survives the difficulty change is the
   cantrips, which is why the encounter keeps a badge at all. */

/** `makeQEHeroicBoard`, moved onto a boss the season singles out and to a chosen difficulty. */
function makeSpecialBoard(dropDifficulty) {
  const sp = SEASON.special;
  const raid = String(sp.raid);
  const enc = Number(finalBosses(Number(raid), sp.lastBosses).at(-1));
  const item = Number(
    Object.keys(QE_DATA.items).find((id) =>
      QE_DATA.items[id].s.some((s) => s[0] === Number(raid) && s[1] === enc),
    ),
  );
  const b = makeQEHeroicBoard();
  b.results = b.results.map((r) => ({ ...r, item, dropDifficulty }));
  return b;
}

/** The card for the encounter a board's report is all about. */
function onlyCard(doc) {
  const cards = [...doc.querySelectorAll("#sources .card")];
  return cards.find((c) => c.querySelector(".special")) || cards[0];
}

test("an end-of-raid boss wears its tier badge where the roll actually pays that tier", () => {
  const card = onlyCard(renderWith([makeSpecialBoard(3)]));
  assert.equal(
    words(card.querySelector(".card-head .special")),
    SEASON.special.badge,
  );
  assert.match(
    words(card.querySelector(".special-note")),
    /^Venomcursed 9\/6\./,
  );
});

test("on Heroic the same boss is badged for what it still gives you, not for ilvl 344", () => {
  const card = onlyCard(renderWith([makeSpecialBoard(2)]));
  const badge = words(card.querySelector(".card-head .special"));
  assert.equal(badge, SEASON.special.badgeAlt);
  assert.doesNotMatch(badge, /9\/6/);
  // Both claims stay on the card; the one that leads is the one this card can act on.
  const note = words(card.querySelector(".special-note"));
  assert.match(note, /rolling here on Heroic is the week-to-week play/);
  assert.match(note, /ilvl 344/, "banking for the Mythic kill is still said");
  assert.match(note, /^Cantrip items\./, "a sentence, so it opens like one");
});

/* Vashnikt, its chest token, the Monk chest it is a voucher for, and one ordinary drop off the same
   boss so the encounter has a row at all — the same fixture tests/model.test.js reasons about. */
const TOKEN = { enc: 2882, id: 270927, piece: 271522, alsoDrops: 268205 };

/** A QE board that scored the tier piece, so the pool carries the token in its place. */
function makeTokenBoard() {
  const drop = (item, score) => ({
    item,
    dropType: "bonus",
    dropDifficulty: 3,
    level: 334,
    score,
    rawDiff: score,
    percDiff: 1,
  });
  return {
    id: "tk",
    key: "tkkey",
    reportId: "r",
    player: "Heals",
    realm: "area-52",
    spec: "Mistweaver Monk",
    source: "qe",
    metric: "raw",
    results: [drop(TOKEN.piece, 4904), drop(TOKEN.alsoDrops, 100)],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
}

// The token's own name says nothing about what you'd wear, so the row names the piece — and a name
// you can't hover is a name you have to go and look up somewhere else. It links to the piece, not to
// the token beside it, and at the level the score was simmed at, so the card and the score agree.
test("the piece a tier token becomes is a link to that piece, not to the token", (t) => {
  if (!QE_DATA.items[TOKEN.id] || !QE_DATA.items[TOKEN.piece])
    return t.skip("a later season doesn't ship this token");
  const doc = renderWith([makeTokenBoard()]);
  const row = doc.querySelector(`.item[data-id="${TOKEN.id}"]`);
  assert.ok(row, "the token is in the rendered pool");
  const link = row.querySelector(".gives-link");
  assert.ok(link, "the piece it becomes is a link");
  assert.equal(link.textContent, QE_DATA.items[TOKEN.piece].n);
  assert.match(link.getAttribute("href"), new RegExp(`item=${TOKEN.piece}$`));
  assert.match(link.getAttribute("data-wowhead"), /&ilvl=\d+$/);
  // ui.js treats a click in a row as a state change unless the link is marked as a way out.
  assert.equal(link.getAttribute("data-act"), "wowhead");
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
      "foo~area52~": {
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
// whose best slot is 308, laid out in the line's own slot order.
test("a /simc under the track overlap is still capped at the maximum", () => {
  const marks = [
    298, 298, 289, 289, 308, 289, 292, 305, 266, 279, 298, 305, 298, 279, 266,
    266, 289,
  ];
  const doc = renderWith([makeBoard()], withMarks(marks));
  const save = words(doc.querySelector("#sources .card .crest-save"));
  assert.match(save, /saves 80 Myth crests/);
  assert.doesNotMatch(save, /100/, "a roll never rescues a misplay");
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /Computed from your/);
  assert.match(note, /slots this pool can land in/);
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
// its top must be the maximum, never above it. The pool here is a whole boss's table, so it can land
// in capped slots and open ones alike.
test("a /simc with slots in mixed states gives a range and says why", () => {
  const marks = Array(17).fill(334);
  marks[9] = 300; // rings under the overlap
  marks[10] = 324; // trinkets part-way up Myth
  const doc = renderWith([makeBoard()], withMarks(marks));
  assert.match(
    words(doc.querySelector("#sources .card .crest-save")),
    /saves 0–80 Myth crests/,
  );
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /between 0 and 80/);
  assert.match(note, /depending which one the roll lands in/);
});

// Only the slots this pool can fill bear on it. A boss with one live item saves what that item's slot
// saves, and the note names the slot rather than quoting a range over a character's capped helm.
test("a pool that can land in one slot quotes that slot's figure, by name", () => {
  const b = makeBoard();
  const row = [...Object.keys(QE_DATA.items)].filter((id) =>
    QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
  );
  // Roll everything but one ring out of the pool, and drop the two synthetic items too.
  const ring = row.find((id) => QE_DATA.items[id].iv === 11);
  if (!ring) return;
  row
    .filter((id) => id !== ring)
    .concat(["900001", "900002"])
    .forEach((id) => {
      b.overlay[`${RAID_ID}:${ENC_ID}:${id}`] = "rolled";
    });
  const marks = Array(17).fill(334);
  marks[9] = 321;
  const doc = renderWith([b], withMarks(marks));
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /your ring slot, the only one this pool can land in/);
  assert.match(
    words(doc.querySelector("#sources .card .crest-save")),
    /saves 80 Myth crests/,
    "not the 0 a capped helm would say",
  );
});

// A one-hander has no mark the app can name yet. The figure for it is the assumption, and the note says
// so rather than calling the whole thing computed.
test("a slot the app can't match to a mark is owned up to, not passed off as computed", () => {
  const doc = renderWith([makeBoard()], withMarks(Array(17).fill(334)));
  const note = words(doc.querySelector("#sources .card .crest-note"));
  assert.match(note, /can’t match to your marks yet/);
});

/* ---------- a vault option, as it comes and finished ----------
   The case that prompted it: a 318 Alluring Bubbleband out of a Heroic vault slot, for someone already
   wearing a 321 copy. Worth nothing as it comes, +2,129 at Myth 6/6 — and the panel used to show only
   the first, so the item never registered as an option at all. */

const RING = 268266;

/** A Mythic 12.1 board: one roll worth `rollScore`, and the ring priced as the real report priced it. */
function makeRingBoard(rollScore) {
  const b = makeQEHeroicBoard();
  const item = b.results[0].item;
  const row = (id, dropType, level, rawDiff) => ({
    item: id,
    dropType,
    dropDifficulty: 3,
    level,
    score: 0,
    rawDiff,
    percDiff: rawDiff / 100,
  });
  b.results = [
    row(item, "drop", 318, rollScore / 2),
    row(item, "bonus", 334, rollScore),
    row(RING, "drop", 318, 0),
    row(RING, "max", 334, 2129),
    row(RING, "bonus", 334, 2129),
  ];
  b.equipped = { [RING]: 321 };
  b.equippedBonus = { [RING]: [6652, 13668, 13334, 12846] }; // Hero 6/6
  b.overlay = { [`1317:2849:${RING}`]: "rolled" };
  return b;
}

/** That board's character with the ring in this week's vault, and a ring watermark of 321. */
function ringVault() {
  const marks = Array(17).fill(334);
  marks[9] = 321;
  return {
    simc: {
      "heals~area52~": {
        owned: {},
        at: new Date().toISOString(),
        watermarks: marks,
        currencies: { 3446: 214 },
        vault: [
          {
            id: RING,
            ilvl: 318,
            name: "Alluring Bubbleband",
            bonus: [6652, 13668, 13334, 12849],
          },
        ],
      },
    },
  };
}

test("a vault option says what it's worth as it comes and finished, and what finishing costs", () => {
  const doc = renderWith([makeRingBoard(40000)], ringVault());
  const opt = doc.querySelector("#vaultPanel .vopt");
  assert.match(words(opt.querySelector(".vmeta")), /Myth 1\/6/);
  const worth = words(opt.querySelector(".vworth"));
  assert.match(
    worth,
    /Worth 0 HPS as it comes — you hold one at Hero 6\/6 \(321\)/,
  );
  assert.match(worth, /2,129 at Myth 6\/6 for 80 Myth crests/);
});

// The whole point of naming the held copy's track: a Myth 1/6 at 318 beside a Hero 6/6 at 321 is the
// lower number and the better item, and the two tracks have to read as two different things at a
// glance — in the colours a character sheet uses for them.
test("the offered track and the held copy's track are told apart by colour", () => {
  const doc = renderWith([makeRingBoard(40000)], ringVault());
  const opt = doc.querySelector("#vaultPanel .vopt");
  assert.equal(words(opt.querySelector(".vmeta .trk.t-myth")), "Myth 1/6");
  assert.equal(words(opt.querySelector(".vworth .trk.t-hero")), "Hero 6/6");
});

// The prompting week: the roll beats the ring even finished, so the lead is the token — but the
// finished ring is still on the banner, with why the figure is 80 and not 100.
test("a roll that beats the finished option still shows what the option becomes", () => {
  const doc = renderWith([makeRingBoard(40000)], ringVault());
  const trade = doc.querySelector("#vaultPanel .trade");
  assert.match(trade.getAttribute("class"), /\broll\b/);
  assert.equal(words(trade.querySelector(".tlead")), "Take the token");
  const fin = words(trade.querySelector(".tfin"));
  assert.match(
    fin,
    /Finished at Myth 6\/6, Alluring Bubbleband is worth 2,129 HPS/,
  );
  assert.match(
    fin,
    /your ring watermark \(321\) already covers the first of its 5 steps/,
  );
  assert.match(fin, /You had 214 Myth crests/);
  assert.match(fin, /short of a roll on .*, which arrives finished/);
});

// With the target gone, the finished ring outscores the roll and costs crests the roll doesn't. The
// lead says what it turns on, and nothing converts the crests into HPS to force an answer.
test("a trade that turns on crests says so, with both numbers", () => {
  const doc = renderWith([makeRingBoard(1200)], ringVault());
  const trade = doc.querySelector("#vaultPanel .trade");
  assert.match(trade.getAttribute("class"), /\bcrests\b/);
  assert.equal(
    words(trade.querySelector(".tlead")),
    "It turns on 80 Myth crests",
  );
  const fin = words(trade.querySelector(".tfin"));
  assert.match(fin, /more than a roll on/);
  assert.match(fin, /what 80 Myth crests are worth to you/);
});

// A ring slot under the free line prices the same 80, but only by assuming the Hero step is bought
// with Hero crests first — the line has to say that, not present the figure as read off the mark.
test("a finished figure that leans on the free-line assumption says so", () => {
  const extra = ringVault();
  extra.simc["heals~area52~"].watermarks[9] = 308;
  const doc = renderWith([makeRingBoard(40000)], extra);
  const fin = words(doc.querySelector("#vaultPanel .tfin"));
  assert.match(fin, /for 80 Myth crests/);
  assert.match(
    fin,
    /your ring watermark is only 308, so that assumes you cap the slot/,
  );
});

// A board saved before bonus ids were kept knows the copy's level and not its track. At 321 that is
// Hero 6/6 or Myth 2/6 — the exact question the vault option turns on — so both are named, with how
// to settle it, rather than a bare item level that reads as if the track didn't matter.
test("a held copy whose track isn't known names both candidates, not a bare item level", () => {
  const b = makeRingBoard(40000);
  delete b.equippedBonus;
  const doc = renderWith([b], ringVault());
  const worth = words(doc.querySelector("#vaultPanel .vopt .vworth"));
  assert.match(worth, /you hold one at Myth 2\/6 or Hero 6\/6 \(321\)/);
  assert.doesNotMatch(worth, /you hold one at 321/);
});

// The reward table is where every track appears at once, so it doubles as the key to the colours.
test("the reward table colours each payout by its track", () => {
  const doc = renderWith([]);
  const cells = [...doc.querySelectorAll("#rewardBody .rwd td .trk")];
  const tracks = new Set(cells.map((c) => c.getAttribute("class")));
  assert.ok(tracks.has("trk t-myth"));
  assert.ok(tracks.has("trk t-hero"));
  assert.ok(tracks.has("trk t-champion"));
});

// On a pool row the held copy's item level is printed in its track's colour, like the character
// sheet prints it, and the hover spells the track out for anyone who can't tell the colours apart.
test("a held copy's item level on a pool row wears its track", () => {
  const b = makeRingBoard(40000);
  b.overlay = {}; // the ring back in its own pool
  const doc = renderWith([b], ringVault());
  const badge = doc.querySelector(`#sources .item[data-id="${RING}"] .have`);
  assert.ok(badge, "the ring's row says you have one");
  assert.equal(words(badge.querySelector(".trk.t-hero")), "321");
  assert.match(badge.getAttribute("title"), /ilvl 321 \(Hero 6\/6\)/);
});

// What the banner used to do, and must not again: price the item unfinished and then credit the roll
// with the crests finishing it would take. That counts one 80 twice, in the roll's favour both times.
test("the banner never credits a roll with crests over an item priced unfinished", () => {
  for (const score of [40000, 1200]) {
    const doc = renderWith([makeRingBoard(score)], ringVault());
    const txt = words(doc.getElementById("vaultPanel"));
    assert.doesNotMatch(txt, /counted in neither number above/);
    assert.doesNotMatch(txt, /roll also saves/);
  }
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
    if (r.ilvl != null) assert.match(body, new RegExp(`\\b${r.ilvl}\\b`));
    if (r.label) assert.match(body, new RegExp(r.label.replace("/", "/")));
  });
});

test("the M+ ladder is on screen, since the ranking only ever quotes its top rung", () => {
  const doc = renderWith([]);
  const mp = REWARD_SEASON.rollReward?.["mythic-plus"];
  const rungs = mp?.ladder || [];
  assert.ok(rungs.length, "the season carries a ladder to render");
  const rows = [...doc.querySelectorAll("#rewardBody .rwd")]
    .map((t) => t.textContent)
    .join(" ");
  rungs.forEach((k) => {
    assert.match(rows, new RegExp(`\\b${k.ilvl}\\b`));
  });
});

// The pane's own statement of the figure, read off the season rather than hard-coded — the number
// is a PTR figure and will move. What's pinned is that the pane leads with it and frames it as a
// saving; see the card test above for why the verb is worth a test at all.
test("the pane leads its crest section with what a roll saves you", () => {
  const doc = renderWith([]);
  const fig = doc.querySelector("#rewardBody .rwd-figure");
  assert.ok(fig, "the saving is a figure in its own right, not a clause");
  const crests = REWARD_SEASON.rollReward?.mythic?.crests;
  assert.ok(crests, "the season has a saving to state");
  assert.match(fig.textContent, new RegExp(`\\b${crests}\\b`));
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
  else assert.match(line.textContent, new RegExp(`week ${now.week}\\b`));
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
