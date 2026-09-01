// The element-id registry, checked against the page it describes.
//
// src/dom.js lists every id the app addresses so that `$` can be typed against it. A list is only
// worth having if it can't drift from the markup, and it can drift in two directions: an id the app
// asks for that index.html no longer has (a runtime throw, on whichever branch touches it), and an
// element in the markup that nothing renders into (dead HTML, or a rename half-done). Both are
// cheap to catch here and expensive to notice in a browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  $,
  IDS,
  setDisplayed,
  setHTML,
  setShown,
  setText,
} from "../src/dom.js";
import { html } from "../src/html.js";
import { loadPage } from "./page.js";

/** Every id actually present in index.html. */
function idsInMarkup() {
  const doc = loadPage();
  return [...doc.querySelectorAll("[id]")]
    .map((el) => el.getAttribute("id"))
    .sort();
}

test("every id the app addresses exists in index.html", () => {
  const present = new Set(idsInMarkup());
  const missing = IDS.filter((id) => !present.has(id));
  assert.deepEqual(
    missing,
    [],
    "src/dom.js names elements the page doesn't have",
  );
});

test("every element in index.html is one the app addresses", () => {
  const declared = new Set(IDS);
  const unused = idsInMarkup().filter((id) => !declared.has(id));
  assert.deepEqual(
    unused,
    [],
    "index.html carries elements nothing renders into",
  );
});

// The controls bar wraps, and a label loose in that flex row wraps independently of the control it
// names — "Loot spec" ending one line with its dropdown starting the next.
test("each control's label shares a wrapper with the control it names", () => {
  const doc = loadPage();
  const labels = [...doc.querySelectorAll(".controls .seg-label")];
  assert.ok(labels.length >= 3, "the bar still has labelled controls");
  labels.forEach((l) => {
    const box = l.parentElement;
    assert.match(
      box.getAttribute("class") || "",
      /\bctl\b/,
      "a label sits loose in the wrapping row",
    );
    assert.ok(
      box.querySelector(".seg, select"),
      "and its wrapper holds the control",
    );
  });
});

test("the registry has no duplicates", () => {
  assert.equal(new Set(IDS).size, IDS.length);
});

test("$ names the id it couldn't find rather than returning null", () => {
  loadPage();
  assert.throws(() => $(/** @type {any} */ ("nopeNotHere")), /nopeNotHere/);
});

test("setHTML renders a fragment and escapes a bare string", () => {
  const doc = loadPage();
  setHTML("sources", html`<b>${"a<b"}</b>`);
  assert.equal(doc.getElementById("sources").innerHTML, "<b>a&lt;b</b>");
  setHTML("sources", "<b>not markup</b>");
  assert.equal(
    doc.getElementById("sources").innerHTML,
    "&lt;b&gt;not markup&lt;/b&gt;",
  );
});

test("setText never renders markup", () => {
  const doc = loadPage();
  setText("seasonLabel", "<b>x</b>");
  assert.equal(doc.getElementById("seasonLabel").textContent, "<b>x</b>");
  assert.equal(doc.getElementById("seasonLabel").querySelector("b"), null);
});

// Two ways to hide, because they answer to different CSS: `hidden` for blocks that leave the
// layout, `display` for controls whose stylesheet rule would otherwise win.
test("setShown toggles hidden and setDisplayed toggles display", () => {
  const doc = loadPage();
  setShown("listHead", false);
  assert.equal(doc.getElementById("listHead").hasAttribute("hidden"), true);
  setShown("listHead", true);
  assert.equal(doc.getElementById("listHead").hasAttribute("hidden"), false);

  setDisplayed("diffSeg", false);
  assert.match(
    doc.getElementById("diffSeg").getAttribute("style") || "",
    /display:\s*none/,
  );
  setDisplayed("diffSeg", true);
  assert.doesNotMatch(
    doc.getElementById("diffSeg").getAttribute("style") || "",
    /display:\s*none/,
  );
});
