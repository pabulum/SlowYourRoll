// The escaping contract. Everything this app renders is third-party text — item names from QE
// Live's database, character names from a pasted report — so these are the tests that say the
// default is safe, and that the one way around it is the one you have to type out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw, join, esc, Html } from "../src/html.js";

const s = (v) => String(v);

test("esc escapes HTML-significant characters", () => {
  assert.equal(esc('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
});

test("esc coerces null/undefined to empty string", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("an interpolated value is escaped without being asked", () => {
  assert.equal(
    s(html`<p>${"<script>alert(1)</script>"}</p>`),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
});

// Attribute values are the other half of it: a quote that survives escaping ends the attribute and
// starts whatever the value wants next.
test("an interpolated attribute value can't break out of its quotes", () => {
  const out = s(html`<div title="${'" onclick="steal()'}"></div>`);
  assert.equal(out, '<div title="&quot; onclick=&quot;steal()"></div>');
});

test("a nested fragment is markup, not text", () => {
  assert.equal(s(html`<p>${html`<b>hi</b>`}</p>`), "<p><b>hi</b></p>");
});

test("an array of fragments joins with nothing between", () => {
  assert.equal(
    s(
      html`<ul>
        ${[1, 2, 3].map((n) => html`<li>${n}</li>`)}
      </ul>`,
    ),
    "<ul><li>1</li><li>2</li><li>3</li></ul>",
  );
});

// The `cond && html` idiom is how every optional badge and note on the page is written, so the
// falsy side has to render as nothing at all rather than as the word "false".
test("null, undefined and false render as nothing", () => {
  assert.equal(s(html`[${null}${undefined}${false}]`), "[]");
});

// …but `true` is a value where it appears, and blanking it would emit `aria-checked=""`.
test("true renders as itself, for the attributes that want it", () => {
  assert.equal(
    s(html`<b aria-checked="${true}"></b>`),
    '<b aria-checked="true"></b>',
  );
});

test("zero and empty string render as themselves, not as absent", () => {
  assert.equal(s(html`[${0}][${""}]`), "[0][]");
});

test("raw is the only way past the escaping", () => {
  assert.equal(s(html`${raw("<br>")}${"<br>"}`), "<br>&lt;br&gt;");
  assert.ok(raw("x") instanceof Html);
});

test("join puts a separator between fragments and escapes it like anything else", () => {
  assert.equal(s(join([html`<b>a</b>`, "b<"], " · ")), "<b>a</b> · b&lt;");
  assert.equal(s(join(["a", "b"], html`<br />`)), "a<br>b");
});

test("join of nothing is nothing", () => {
  assert.equal(s(join([], " · ")), "");
});

// A fragment that reached the DOM once and came back must not be escaped a second time.
test("a fragment survives a round trip through interpolation unchanged", () => {
  const once = html`<b>${"a&b"}</b>`;
  assert.equal(s(html`${once}`), s(once));
});
