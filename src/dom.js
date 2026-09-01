// Reaching into the page: the ids the app owns, and the handful of mutations it makes to them.
//
// Every element id lives in the list below rather than being spelled out at each call site. That
// buys two things a scattering of string literals can't: `$` is typed against the list, so a
// renamed id in index.html is a type error everywhere it's used instead of a null at runtime; and
// tests/dom.test.js checks the list against the real markup in both directions, so an id that
// leaves the HTML and an element nothing ever touches are both visible.

import { part } from "./html.js";

/** Every element id in index.html the app addresses. In the order they appear in the markup. */
export const IDS = /** @type {const} */ ([
  // masthead
  "seasonLabel",
  "themeBtn",
  "rewardBtn",
  "importBtn",
  "exportBtn",
  "importFile",
  // report input
  "reportInput",
  "loadBtn",
  // /simc panel
  "simcBox",
  "simcInput",
  "simcBtn",
  // controls bar
  "controls",
  "boardPicker",
  "boardBtn",
  "boardMenu",
  "specBadge",
  "shareBoard",
  "delBoard",
  "metricSeg",
  "diffCtl",
  "diffSeg",
  "lootSpecCtl",
  "lootSpecSel",
  "showAll",
  // notices and the ranking itself
  "dataNote",
  "lootNote",
  "simcNote",
  "vaultPanel",
  "verdict",
  "listHead",
  "sources",
  // legend + transient
  "tokenNote",
  "rewardNote",
  "rewardLink",
  // reward pane
  "rewardPane",
  "rewardTitle",
  "rewardClose",
  "rewardBody",
  "toast",
]);

/** @typedef {typeof IDS[number]} ElementId */

/**
 * An element by id. Returns `any` so callers can reach element-specific properties (.value,
 * .checked, .open) without a cast at every use.
 *
 * Throws when the element is missing, which is always a bug in this app rather than a state to
 * handle: the markup is ours and static. A thrown error names the id; a silent null surfaces
 * later as "cannot read properties of null" somewhere unrelated.
 *
 * @param {ElementId} id
 * @returns {any}
 */
export function $(id) {
  const el = document.getElementById(id);
  if (!el)
    throw new Error(`No element #${id} — src/dom.js and index.html disagree`);
  return el;
}

/**
 * Replace an element's content with rendered markup: an `html` fragment, an array of them, or
 * nothing at all. A bare string is *escaped*, exactly as it would be inside the tag — reaching
 * the DOM is not a reason for a value to stop being data.
 * @param {ElementId} id
 * @param {unknown} content
 */
export function setHTML(id, content) {
  $(id).innerHTML = part(content);
}

/**
 * Set an element's text. Distinct from setHTML on purpose — this is the safe one for a bare
 * string, and using it says the value was never meant to be markup.
 * @param {ElementId} id
 * @param {string} text
 */
export function setText(id, text) {
  $(id).textContent = text;
}

/**
 * Show or hide via the `hidden` attribute — for elements that are absent from the layout when off.
 * @param {ElementId} id
 * @param {boolean} on
 */
export function setShown(id, on) {
  $(id).hidden = !on;
}

/**
 * Show or hide via `display` — for controls that sit in a flex row, where `hidden` and a
 * `display` rule from the stylesheet would fight over which wins.
 * @param {ElementId} id
 * @param {boolean} on
 */
export function setDisplayed(id, on) {
  $(id).style.display = on ? "" : "none";
}

/** Show a transient message at the bottom of the screen. */
let toastTimer;
export function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
