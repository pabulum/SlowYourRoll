import assert from "node:assert/strict";
import { test } from "node:test";
import { charKeyOf, keyOf, replaceState, state, uid } from "../src/store.js";

test("keyOf normalizes name, realm, and the first word of spec", () => {
  assert.equal(
    keyOf("Fóo", "Area 52", "Holy Priest", "US"),
    "foo~area52~us~holy",
  );
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

test("keyOf keeps names in any script apart", () => {
  // The ASCII-only key reduced both of these to "", so they shared a board and a /simc.
  assert.notEqual(
    keyOf("Светлана", "Гордунни", "Holy"),
    keyOf("Мария", "Гордунни", "Holy"),
  );
});

test("keyOf reads a /simc spec the way it reads a report's", () => {
  assert.equal(
    keyOf("Foo", "Area 52", "beast_mastery"),
    keyOf("Foo", "area-52", "Beast Mastery Hunter"),
  );
});

test("charKeyOf is one key for all of a character's specs, and never a board key", () => {
  assert.equal(charKeyOf("Fóo", "Area 52", "us"), "foo~area52~us");
  assert.notEqual(charKeyOf("Foo", "Realm", ""), keyOf("Foo", "Realm", "", ""));
});

test("a restored state is rekeyed, and each per-spec /simc moves to its character", () => {
  const saved = { ...state };
  const older = { owned: { 1: 600 }, at: "2026-09-01T00:00:00Z" };
  const newer = { owned: { 1: 610 }, at: "2026-09-20T00:00:00Z" };
  const board = (id, key, spec) => ({
    id,
    key,
    player: "Мария",
    realm: "Area 52",
    region: "us",
    spec,
  });
  replaceState(
    /** @type {any} */ ({
      boards: [
        board("a", "~area52~holy", "Holy Priest"),
        board("b", "~area52~discipline", "Discipline Priest"),
      ],
      activeId: "a",
      simc: { "~area52~holy": newer, "~area52~discipline": older },
    }),
  );
  try {
    assert.deepEqual(
      state.boards.map((b) => b.key),
      ["мария~area52~us~holy", "мария~area52~us~discipline"],
    );
    assert.deepEqual(state.simc, { "мария~area52~us": newer });
  } finally {
    replaceState(/** @type {any} */ (saved));
  }
});

test("the same name on two realms is two characters", () => {
  assert.notEqual(
    charKeyOf("Foo", "Area 52", "us"),
    charKeyOf("Foo", "Stormrage", "us"),
  );
});

test("the same name and realm in two regions are two characters", () => {
  assert.notEqual(
    charKeyOf("Foo", "Area 52", "us"),
    charKeyOf("Foo", "Area 52", "eu"),
  );
});
