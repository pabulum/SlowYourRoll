// Links out to Wowhead, which its widget turns into tooltips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { iconHTML, nameHTML } from "../src/wowhead.js";

// The renderers return `Html` fragments, not strings; `String()` is what setHTML does with them.
const markup = (frag) => String(frag);

const BRACERS = 249327; // Void-Skinned Bracers — has an icon in the database

test("an item links to Wowhead at the item level this source drops it at", () => {
  // Retail derives an item's stats from its item level, so a bare item link describes a version of
  // the item nobody loots. The drop's own level is what makes the card's numbers the real ones.
  const html = markup(nameHTML(BRACERS, "Void-Skinned Bracers", 4, 707));
  assert.match(html, /href="https:\/\/www\.wowhead\.com\/item=249327"/);
  assert.match(html, /data-wowhead="item=249327&amp;ilvl=707"/);
  assert.match(html, /rel="noopener"/);
});

test("an item with no known drop level still links", () => {
  const html = markup(nameHTML(BRACERS, "Void-Skinned Bracers", 4, 0));
  assert.match(html, /data-wowhead="item=249327"/);
  assert.doesNotMatch(html, /ilvl/);
});

test("the icon link is marked so a click isn't treated as a state change", () => {
  // ui.js cycles Want/Own/Rolled from clicks inside a row; the link has to opt out of that.
  assert.match(markup(iconHTML(BRACERS, 707)), /data-act="wowhead"/);
});

test("an item with no icon leaves a placeholder rather than a broken image", () => {
  assert.match(markup(iconHTML(999999999, 0)), /class="icon blank"/);
});

test("item names are escaped, not interpolated raw", () => {
  assert.match(
    markup(nameHTML(BRACERS, "<script>x</script>", 4, 0)),
    /&lt;script&gt;/,
  );
});
