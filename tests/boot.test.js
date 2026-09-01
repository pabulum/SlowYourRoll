// Booting the entry point, the way index.html does.
//
// The narrowest possible test and the broadest: it asserts almost nothing about behaviour, and it
// exercises the entire import graph, every listener `initUI` binds, and a first render — against
// the real page. Anything that throws on the way up fails here, which is otherwise a blank page
// with a console message nobody is watching.
//
// In its own file because importing main.js runs it, and a module runs once per process.

import assert from "node:assert/strict";
import { test } from "node:test";

// The handful of browser globals outside the document that main.js reaches for on the way up.
globalThis.location = /** @type {any} */ ({
  search: "",
  pathname: "/",
  hash: "",
  href: "http://localhost/",
});
globalThis.history = /** @type {any} */ ({ replaceState() {} });

test("main.js wires up the app and renders without a report", async () => {
  await import("../src/main.js");
  assert.match(
    document.getElementById("sources").textContent,
    /Paste a QE Live/,
  );
  assert.equal(
    document.getElementById("controls").hasAttribute("hidden"),
    true,
  );
  // renderSeason ran: the label is filled from src/season.js, not baked into the markup.
  assert.match(
    document.getElementById("seasonLabel").textContent,
    /^WoW S\d+ /,
  );
});
