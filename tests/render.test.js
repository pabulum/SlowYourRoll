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

test("the vault panel prices the choice both ways and offers to take it", () => {
  const doc = renderWith([makeBoard()], {
    simc: {
      testkey: {
        owned: {},
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
