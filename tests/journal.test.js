// Pools checked against the game itself.
//
// Every other test in this suite asserts that the code does what the code intends. This one asserts
// that what it intends is true, against the only source that can settle it: the in-game Encounter
// Journal, read on 2026-08-17 on a Mistweaver Monk. Nothing in the item database, in QE Live or in
// Raidbots is more authoritative than this, and three separate mistakes were caught by it that no
// amount of reading upstream would have found:
//
//   - Tier set *pieces* were pooled alongside the tier *token* for the same slot. The boss drops the
//     token; you trade it for the piece. Every tier boss was one item too big, for every class.
//   - Three cosmetic head pieces and the Slumbering Coil Curio were in the pools.
//   - Knot of Writhing Serpents was in a healer's pool, and no healer can be awarded it.
//
// The numbers here are small on purpose — a bonus-roll pool for one loot spec is a handful of items,
// which is exactly why a single spurious entry moved Ula'tek's expected value by a third.
//
// When a season turns over these fixtures stop describing current content and the test skips itself
// rather than failing, since it has nothing true left to say. Re-read the journal and replace them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { canLoot, isRollable, specId } from "../src/loot.js";

/**
 * What the journal listed per encounter with loot spec set to Mistweaver Monk. Keys are
 * "instanceId:encounterId", with -1 for a M+ dungeon, as `Item.s` records them.
 */
const MISTWEAVER = {
  "1320:2882": [
    // Vashnikt — the Venomcured Icon is the *chest* token, and the Monk chest piece it buys
    // (Battle Gi of the Monkey King) is deliberately not here.
    "Venomcured Icon",
    "Venomancer's Winged Channeler",
    "Frothing Venom Spaulders",
    "Vile Alchemist's Band",
  ],
  "1320:2894": [
    "Venomcured Remnant", // shoulder token
    "Malevolent Spiritcudgel",
    "Unpossessed Skullsash",
    "Gebbo's Bottomless Bag",
  ],
  "1320:2887": [
    "Venomcured Effigy", // head token
    "Amulet of the Twin Fangs",
    "Bespittled Slitherslippers",
    "Preternatural Antivenom",
  ],
  "1320:2874": [
    "Venomcured Idol", // hand token
    "Spine of the Hissing Abyss",
    "Shadow Hunter's Warmask",
    "Sentinel's Vitriolic Chain",
  ],
  "-1:1322": [
    // Altar of Fangs. Knot of Writhing Serpents drops here and is absent on purpose: its spec list
    // is caster DPS with no healer in it, which is the distinction `p` exists to carry.
    "Venom-Etched Crescent",
    "Nocuous Focal Fang",
    "Spare Speaker's Hood",
    "Strand of Warding Fangs",
    "Snakeskin Spaulders",
    "Band of the Amani Warlord",
    "Vile Vial of Volatile Venom",
  ],
  "-1:1313": [
    // Voidscar Arena. Mindpiercer's Sigil is here, and QE Live's database can't see it at all.
    "Graft of the Domanaar",
    "Somber Spaulders",
    "Hide of Pestilence",
    "Gravitic Girdle",
    "Sickening Signet of Atroxus",
    "Mindpiercer's Sigil",
  ],
  "-1:1309": [
    // The Blinding Vale. Same for Sapling of the Dawnroot.
    "Luminescent Sprout",
    "Bloodthorn Burnous",
    "Rootwarden Wraps",
    "Rootwalker Harness",
    "Lightspore Leggings",
    "Lightwarden's Bind",
    "Lightspire Core",
    "Sapling of the Dawnroot",
    "Seed of Radiant Hope",
  ],
};

/**
 * The same two encounters read with the loot-spec filter off — the whole table, every class.
 *
 * Compared against the *rollable* half of each table rather than all of it. The journal lists more
 * than a roll can hand over, and the two readings were transcribed differently for it: Ula'tek's
 * keeps the Slumbering Coil Curio in place, Coiled Altar's has the cosmetics lifted out and named
 * separately, along with a decor item this database doesn't carry at all. Filtering both sides
 * through `isRollable` is the comparison that means something, and the exclusions have their own
 * test below.
 */
const ALL_SPECS = {
  "1320:2895": [
    "Slumbering Coil Curio", // listed by the journal, but handed over rather than rolled for
    "Abyssal Broodfiend's Bardiche",
    "Jaw of the Shackled Goddess",
    "Caustic Repose Greatbow",
    "Gaze of the Coiled Watcher",
    "Venomkeeper's Horrific Cowl",
    "Aqirbane Reliquary",
    "Awoken Dreadfang Cuirass",
    "Chausses of Unbound Rancor",
    "Font of Venomous Rage",
    "Voracious Heart of Ula'tek",
    "Zatha'tek, Breath of Corruption",
    "Jan'thrazet, the Soul Fang",
  ],
  "1320:2883": [
    "Baleful Hexblade",
    "Soulslither Spaulders",
    "Silken Voodoo Drape",
    "Reckless Spirit Breastplate",
    "Grasps of the Eternal Shadow",
    "Girdle of Toxic Regret",
    "Sash of the Forlorn Vessel",
    "Coiled Hex Legguards",
    "Cuisses of the Uncoiled Union",
    "Cackling Soultreads",
    "Hex Lord's Dooming Idol",
    "Zul'jin's Guillotine Technique",
    "Maze-roa, Warlord's Fury",
    "Aman'muso, Warlord's Vengeance",
  ],
};

/** Apostrophes and commas vary between the game's text and the database's; letters don't. */
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z]/g, "");

/** Every item the database files against a source, as the pool builder reads them. */
function tableAt(key) {
  const [inst, enc] = key.split(":").map(Number);
  return Object.keys(QE_DATA.items)
    .filter((id) =>
      QE_DATA.items[id].s.some((s) => s[0] === inst && s[1] === enc),
    )
    .map((id) => ({ id, ...QE_DATA.items[id] }));
}

/** Assert two name lists describe the same set, reporting both directions. */
function sameSet(mine, want, where) {
  const wn = new Set(want.map(norm));
  const mn = new Set(mine.map(norm));
  assert.deepEqual(
    mine.filter((n) => !wn.has(norm(n))).sort(),
    [],
    where + ": pooled but not in the journal",
  );
  assert.deepEqual(
    want.filter((n) => !mn.has(norm(n))).sort(),
    [],
    where + ": in the journal but not pooled",
  );
}

const MW = specId("Mistweaver Monk");

test("a Mistweaver's pools are exactly what the journal lists", (t) => {
  if (!MW) return t.skip("the database no longer knows Mistweaver Monk");
  for (const [key, want] of Object.entries(MISTWEAVER)) {
    const table = tableAt(key);
    if (!table.length) return t.skip(`${key} is not in this season's database`);
    const pooled = table
      .filter((i) => isRollable(i) && canLoot(i, MW).ok)
      .map((i) => i.n);
    sameSet(pooled, want, key);
  }
});

// The tier piece is the failure this fixture exists to hold down: it is leather with an
// agility-or-intellect line, so armor and stat can't tell it from loot, and the database upstream
// files it against the boss that drops the token you trade for it.
test("a tier boss offers the token, not the piece the token buys", (t) => {
  if (!MW) return t.skip("the database no longer knows Mistweaver Monk");
  const table = tableAt("1320:2882");
  if (!table.length) return t.skip("Vashnikt is not in this season's database");
  const pooled = table.filter((i) => isRollable(i) && canLoot(i, MW).ok);
  assert.ok(
    pooled.some((i) => /Venomcured Icon/.test(i.n)),
    "the token a Monk can be awarded is in the pool",
  );
  assert.equal(
    pooled.filter((i) => /Monkey King/.test(i.n)).length,
    0,
    "and the Monk tier chest it buys is not",
  );
});

test("a full loot table matches the journal with the spec filter off", (t) => {
  for (const [key, want] of Object.entries(ALL_SPECS)) {
    const table = tableAt(key);
    if (!table.length) return t.skip(`${key} is not in this season's database`);
    // No eligibility filter: this is the raid's whole table, not one spec's slice of it. Only the
    // items a roll can't award are dropped, from both sides.
    const rollableNames = new Set(
      table.filter(isRollable).map((i) => norm(i.n)),
    );
    const excluded = new Set(
      table.filter((i) => !isRollable(i)).map((i) => norm(i.n)),
    );
    sameSet(
      [...rollableNames].map((n) => table.find((i) => norm(i.n) === n).n),
      want.filter((n) => !excluded.has(norm(n))),
      key,
    );
  }
});

// The journal lists all four and a roll awards none of them, which is a distinction the journal
// itself cannot draw — it says what an encounter can give you, not what a bonus roll draws from.
// Settled elsewhere: the Monk Discord confirmed on 2026-08-17 that the Slumbering Coil Curio cannot
// be bonus rolled into, for any class, and QE Live's Upgrade Finder excludes all four. The Curio is
// a currency traded at a vendor for a tier piece; the other three are transmog appearances.
test("the journal lists these, and a roll still can't hand them to you", (t) => {
  const named = {
    270909: "Slumbering Coil Curio",
    275937: "Hex Lord's Visage",
    275938: "Hex Lord's Gaze",
    281227: "Soulcoiler's Rush'kah",
  };
  const present = Object.keys(named).filter((id) => QE_DATA.items[id]);
  if (!present.length) return t.skip("a later season ships none of these");
  for (const id of present) {
    assert.equal(isRollable(QE_DATA.items[id]), false, named[id]);
  }
});
