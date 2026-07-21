import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, fmt } from "../src/util.js";

test("esc escapes HTML-significant characters", () => {
  assert.equal(esc('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
});

test("esc coerces null/undefined to empty string", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("fmt rounds to at most two decimals", () => {
  assert.equal(fmt(15), "15");
  assert.equal(fmt(15.005), "15.01");
  assert.equal(fmt(15.004), "15");
});
