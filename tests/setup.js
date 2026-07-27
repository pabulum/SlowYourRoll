// Preloaded before every test file (via `node --import`). The app modules are written for the
// browser; this supplies the browser.
//
// The DOM is the real index.html parsed by linkedom, not a stub. A stub that answers every
// getElementById with the same object agrees with any markup at all — including markup that isn't
// there — which makes every assertion that touches the page quietly vacuous. Parsing the shipped
// page costs a millisecond and can't do that.

import { readFileSync } from "node:fs";
import { loadPage } from "./page.js";
import { setQEData } from "../src/data.js";

// The app fetches the database over HTTP (src/data.js); Node's fetch can't read a file:// URL, and
// test files read QE_DATA at module scope. `--import` awaits this module before any of them
// evaluate, so injecting it here means the suites see a loaded database exactly as the browser does.
setQEData(
  JSON.parse(
    readFileSync(new URL("../data/qe-data.json", import.meta.url), "utf8"),
  ),
);

/** @type {Map<string, string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

// Not part of the page: the theme toggle asks the OS what it prefers.
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));

loadPage();
