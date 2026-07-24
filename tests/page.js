// A real DOM over the real index.html.
//
// Every test runs against the page the browser actually loads, so an assertion about rendering is
// also an assertion about the shipped markup — a renamed id or a deleted element fails a test
// rather than a page. tests/setup.js installs one at startup; a test that renders calls `loadPage`
// again for a clean one.
//
// `$` resolves elements at call time, so replacing the global document is enough — the app modules
// need no knowledge of any of this.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const INDEX = fileURLToPath(new URL("../index.html", import.meta.url));

/**
 * Parse index.html and install it as the global document. Returns the document, so a test can
 * query it. Call once per test that renders; each call is a fresh page.
 */
export function loadPage() {
  const { document } = parseHTML(readFileSync(INDEX, "utf8"));
  globalThis.document = /** @type {any} */ (document);
  return document;
}
