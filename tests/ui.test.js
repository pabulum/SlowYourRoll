// Event wiring, driven through the real markup.
//
// Listeners are delegated to containers that survive re-rendering, which is the part that is easy
// to get subtly wrong: bind to a row and it works until the first redraw, then silently stops.
// Clicking a rendered element and asserting on the state it changed is the only way to see that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { state } from "../src/store.js";
import { initUI } from "../src/ui.js";
import { render } from "../src/render.js";
import { loadPage } from "./page.js";

const RAID_ID = Number(QE_DATA.currentRaids[0]);
const ENC_ID = Number(Object.keys(QE_DATA.raids[String(RAID_ID)].bosses)[0]);
const KEY = RAID_ID + ":" + ENC_ID;

function makeBoard() {
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
    results: [
      {
        item: 900001,
        inst: RAID_ID,
        enc: ENC_ID,
        diff: "mythic",
        level: 639,
        score: 10,
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
    _open: KEY,
  };
}

/** A fresh page with the UI wired up and one report rendered. */
function boot(extra = {}) {
  const doc = loadPage();
  const board = makeBoard();
  Object.assign(
    state,
    { boards: [board], activeId: "t", showAll: false, simc: {} },
    extra,
  );
  initUI();
  render();
  return { doc, board };
}

/** Click an element the way a browser would — bubbling up to the delegated listener. */
function click(doc, selector) {
  const el = doc.querySelector(selector);
  assert.ok(el, "expected to find " + selector);
  el.dispatchEvent(new doc.defaultView.Event("click", { bubbles: true }));
  return el;
}

test("tapping an item cycles Want → Own → Rolled → Want", () => {
  const { doc, board } = boot();
  const sel = '#sources .item[data-id="900001"] [data-act="cycle"]';
  const k = KEY + ":900001";

  click(doc, sel);
  assert.equal(board.overlay[k], "own");
  click(doc, sel);
  assert.equal(board.overlay[k], "rolled");
  // Back to Want is the *absence* of an override, not a third stored value.
  click(doc, sel);
  assert.equal(k in board.overlay, false);
});

test("the cycle survives the re-render it causes", () => {
  const { doc, board } = boot();
  const sel = '#sources .item[data-id="900001"] [data-act="cycle"]';
  click(doc, sel);
  // The button just clicked no longer exists — render() replaced it. If listeners were bound to
  // rows rather than to #sources, this second click would do nothing.
  click(doc, sel);
  assert.equal(board.overlay[KEY + ":900001"], "rolled");
  assert.match(
    doc.querySelector('#sources .item[data-id="900001"]').getAttribute("class"),
    /st-rolled/,
  );
});

test("tapping a card head expands and collapses it", () => {
  const { doc, board } = boot();
  assert.equal(board._open, KEY);
  click(doc, "#sources .card-head");
  assert.equal(board._open, null);
  click(doc, "#sources .card-head");
  assert.equal(board._open, KEY);
});

test("clicking an item's Wowhead link is left to the browser", () => {
  const { doc, board } = boot();
  click(doc, "#sources .item .icon-link, #sources .item .iname-link");
  assert.deepEqual(board.overlay, {}, "a link out is not a state change");
});

test("a token cost override is clamped to at least one token", () => {
  const { doc, board } = boot();
  // Re-queried each time on purpose: the change re-renders the card, so the input just typed into
  // is gone by the next line — the same reason the listener lives on #sources.
  const setCost = (v) => {
    const input = doc.querySelector('#sources [data-act="cost"]');
    input.value = v;
    input.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  };
  setCost("0");
  assert.equal(board.tokenOverride[KEY], 1, "a free roll would divide by zero");
  setCost("3");
  assert.equal(board.tokenOverride[KEY], 3);
});

test("taking a vault item toggles, and toggles back off", () => {
  const { doc, board } = boot({
    simc: {
      testkey: { owned: {}, vault: [{ id: 900001, ilvl: 639, name: "V" }] },
    },
  });
  click(doc, '#vaultPanel [data-vault="900001"]');
  assert.equal(board.vaultTake, 900001);
  click(doc, '#vaultPanel [data-vault="900001"]');
  assert.equal(board.vaultTake, null);
});

test("the show-older-content toggle drives the shared filter, not the board", () => {
  const { doc } = boot();
  const box = doc.getElementById("showAll");
  box.checked = true;
  box.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  assert.equal(state.showAll, true);
});

test("switching report makes it the active one", () => {
  const second = {
    ...makeBoard(),
    id: "t2",
    key: "testkey2",
    spec: "discipline",
  };
  const { doc } = boot();
  state.boards.push(second);
  render();
  click(doc, '#boardMenu [data-board="t2"]');
  assert.equal(state.activeId, "t2");
});
