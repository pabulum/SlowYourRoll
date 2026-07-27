import { test } from "node:test";
import assert from "node:assert/strict";
import { keyOf, uid } from "../src/store.js";

test("keyOf normalizes name, realm, and the first word of spec", () => {
  assert.equal(keyOf("Fóo", "Area 52", "Holy Priest"), "fo~area52~holy");
});

test("keyOf is stable across spec's trailing words", () => {
  assert.equal(
    keyOf("Foo", "Realm", "Holy Priest"),
    keyOf("Foo", "Realm", "Holy Paladin"),
  );
});

test("uid produces unique values", () => {
  assert.notEqual(uid(), uid());
});
