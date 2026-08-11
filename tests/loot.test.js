// Who a bonus roll can actually hand an item to.
//
// The case that prompted this: QE Live's item database is a healer database — every item in it is
// intellect and none of it records spec eligibility, so a Mistweaver's upgrade report listed
// Shadow of the Empyrean Requiem (a caster-DPS trinket no Monk spec can be awarded) right beside
// Light of the Cosmic Crescendo (the healer one). Both were counted in the pool, halving the
// encounter's EV against reality. Blizzard's own spec list, via Raidbots, is what tells them apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { QE_DATA } from "../src/data.js";
import { state } from "../src/store.js";
import { canLoot, specId, specInfo, specIdInClass } from "../src/loot.js";
import { buildGroups } from "../src/model.js";

const MISTWEAVER = "270";
const CASTER_TRINKET = 249810; // Shadow of the Empyrean Requiem
const HEALER_TRINKET = 249811; // Light of the Cosmic Crescendo

// The two trinkets above are the Season 1 pair the header describes, and the rule tests below still
// use them: they are the case that prompted the file, and the item database keeps old items forever.
// Anything that has to *rank* an encounter needs current content instead, because a pool the season
// no longer offers doesn't rank at all — which is how a season rollover breaks these tests rather
// than the loot rules they cover. Twin Fangs is Season 2's copy of the same shape: an intellect
// trinket no Monk spec can be awarded, beside the healer one, in a table with cloth, mail and plate.
const TWIN_FANGS = [1320, 2887];
const BLOCKED_TRINKET = 270170; // Vexhul's Everflowing Gland — no Monk spec can loot it
const MW_TRINKET = 270171; // Preternatural Antivenom — healer specs only, so Mistweaver but not WW

test("spec names resolve however the report spells them", () => {
  assert.equal(specId("Mistweaver Monk"), MISTWEAVER, "QE sends the full name");
  assert.equal(
    specId("mistweaver"),
    MISTWEAVER,
    "a Droptimizer's simc input sends the short one",
  );
  assert.equal(specInfo(MISTWEAVER).c, "Monk");
});

test("an ambiguous spec name resolves to nothing rather than a guess", () => {
  // "Holy" is a priest and a paladin. Guessing would filter a pool by the wrong class entirely.
  assert.equal(specId("holy"), null);
  assert.equal(specId(""), null);
  assert.equal(specId("Shadowmancer"), null);
});

test("primary stat is inferred per spec, not assumed from the class", () => {
  // Midnight's Devourer demon hunter is intellect where every other demon hunter is agility, so
  // this has to come from the data. If it's ever assumed, this is the test that catches it.
  const dh = Object.keys(QE_DATA.specs).filter(
    (id) => QE_DATA.specs[id].c === "Demon Hunter",
  );
  const stats = dh.map((id) => QE_DATA.specs[id].st);
  assert.ok(
    stats.every((s) => s),
    "every spec needs a primary stat to filter by",
  );
  assert.equal(QE_DATA.specs[MISTWEAVER].st, "int");
});

test("a caster-DPS trinket is not lootable by any Monk spec", () => {
  const v = canLoot(QE_DATA.items[CASTER_TRINKET], MISTWEAVER);
  assert.equal(v.ok, false);
  assert.match(
    v.why,
    /No Monk spec/,
    "no sibling spec can take it either — a swap wouldn't help",
  );
  assert.equal(v.swap, undefined);
});

test("the healer trinket from the same boss is lootable", () => {
  assert.equal(canLoot(QE_DATA.items[HEALER_TRINKET], MISTWEAVER).ok, true);
});

test("armor a class can't wear is blocked, and named", () => {
  const cloth = Object.keys(QE_DATA.items)
    .map(Number)
    .filter((id) => {
      const it = QE_DATA.items[id];
      return (
        it.c === 4 &&
        it.u === 1 &&
        it.iv !== 16 &&
        !it.p &&
        it.s.some((s) => s[0] === TWIN_FANGS[0] && s[1] === TWIN_FANGS[1])
      );
    })[0];
  assert.ok(cloth, "Twin Fangs drops a cloth piece");
  const v = canLoot(QE_DATA.items[cloth], MISTWEAVER);
  assert.equal(v.ok, false);
  assert.match(v.why, /Cloth — Monk wears Leather/);
});

test("armor that rolls either primary stat is lootable by every spec that takes one", () => {
  // Leather and mail carry Blizzard's flexible primary (stat id 73, "agility or intellect"), which
  // resolves when the item drops. Reading that as a single stat — as QE's healer-only database
  // reports it — would hide a Windwalker's own bracers from them.
  const BRACERS = 249327; // Void-Skinned Bracers
  assert.equal(QE_DATA.items[BRACERS].st, "ai");
  for (const spec of ["270", "269", "268"]) {
    // Mistweaver, Windwalker, Brewmaster
    assert.equal(
      canLoot(QE_DATA.items[BRACERS], spec).ok,
      true,
      specInfo(spec).n + " can win leather",
    );
  }
});

test("an unknown spec filters nothing", () => {
  assert.equal(canLoot(QE_DATA.items[CASTER_TRINKET], null).ok, true);
});

test("blocked items stay visible but leave the EV pool", () => {
  state.showAll = false;
  state.simc = {};
  const b = {
    id: "t",
    key: "k",
    reportId: "r",
    player: "Foo",
    realm: "area-52",
    spec: "Mistweaver Monk",
    source: "qe",
    results: [
      {
        item: BLOCKED_TRINKET,
        score: 400,
        level: 700,
        dropDifficulty: "Mythic",
      },
      {
        item: MW_TRINKET,
        score: 300,
        level: 700,
        dropDifficulty: "Mythic",
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
  const row = buildGroups(b).rows.filter(
    (r) => r.g.key === TWIN_FANGS.join(":"),
  )[0];

  // The pool is the boss's whole loot table, split by what this loot spec can be handed.
  const table = Object.keys(QE_DATA.items).filter((id) =>
    QE_DATA.items[id].s.some(
      (s) => s[0] === TWIN_FANGS[0] && s[1] === TWIN_FANGS[1],
    ),
  );
  const blocked = table.filter(
    (id) => !canLoot(QE_DATA.items[id], MISTWEAVER).ok,
  );

  assert.ok(row, "the encounter still ranks");
  assert.equal(
    row.items.length,
    table.length,
    "every drop is listed, scored or not",
  );
  assert.ok(
    blocked.length >= 4,
    "cloth, mail, plate and the caster trinket are all off-limits",
  );
  assert.equal(row.nBlocked, blocked.length);
  assert.equal(
    row.remaining,
    table.length - blocked.length,
    "only what it can award is in the pool",
  );
  assert.equal(
    row.num,
    300,
    "the caster trinket's 400 doesn't count toward what you'd win",
  );
  assert.ok(
    row.items.some((i) => i.id === BLOCKED_TRINKET && i.elig === false),
    "it stays visible, flagged",
  );
});

test("a spec that dodges dead weight is offered as the better roll", () => {
  // Twin Fangs, as a Mistweaver: Preternatural Antivenom is a healer-only trinket no agility spec
  // can be given. Looting as Windwalker sheds it and keeps every piece of leather, so the same
  // wanted value is drawn from a smaller pool — the whole reason to switch spec before rolling.
  const ANTIVENOM = MW_TRINKET,
    BOOTS = 268261, // Bespittled Slitherslippers
    HELM = 271519; // Monkey King's Unyielding Visage
  state.showAll = false;
  state.simc = {};
  const b = {
    id: "t",
    key: "k",
    reportId: "r",
    player: "Foo",
    realm: "area-52",
    spec: "Mistweaver Monk",
    source: "qe",
    results: [
      { item: BOOTS, score: 200, level: 707, dropDifficulty: "Mythic" },
      { item: HELM, score: 150, level: 707, dropDifficulty: "Mythic" },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
  const row = buildGroups(b).rows.filter(
    (r) => r.g.key === TWIN_FANGS.join(":"),
  )[0];

  const antivenom = row.items.filter((i) => i.id === ANTIVENOM)[0];
  assert.ok(antivenom, "the antivenom is in a Mistweaver's pool");
  assert.deepEqual(antivenom.specs, ["270"], "and in no other Monk spec's");

  const ww = row.alts.filter((a) => a.spec === "269")[0];
  assert.ok(ww, "Windwalker is offered as a better roll");
  assert.equal(ww.remaining, row.remaining - 1);
  assert.ok(ww.ev > row.ev);
  assert.deepEqual(ww.dodges, ["Preternatural Antivenom"]);
  assert.deepEqual(ww.loses, [], "nothing worth anything is given up");
});

test("changing loot spec changes the pool", () => {
  state.showAll = false;
  state.simc = {};
  const b = {
    id: "t",
    key: "k",
    reportId: "r",
    player: "Foo",
    realm: "area-52",
    spec: "Mistweaver Monk",
    source: "qe",
    results: [
      {
        item: MW_TRINKET,
        score: 300,
        level: 700,
        dropDifficulty: "Mythic",
      },
    ],
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  };
  const asHealer = buildGroups(b).rows.filter(
    (r) => r.g.key === TWIN_FANGS.join(":"),
  )[0];

  b.lootSpec = "269"; // Windwalker: agility, so a different half of the same table
  const asWindwalker = buildGroups(b).rows.filter(
    (r) => r.g.key === TWIN_FANGS.join(":"),
  )[0];

  assert.notEqual(
    asWindwalker.remaining,
    asHealer.remaining,
    "a different spec draws from a different pool",
  );
  assert.equal(
    asWindwalker.num,
    0,
    "the report never simmed Windwalker, so nothing has a value yet",
  );
});

// Half the spec names in the game belong to two classes, so `specId` refuses to guess at a bare
// one. A /simc writes `loot_spec=holy` bare, but names its class two lines above, so within a
// class the name is unambiguous — which is the only reason the loot spec is readable at all.
test("a bare spec name that two classes share resolves within one class", () => {
  const holyPaladin = specId("Holy Paladin");
  const holyPriest = specId("Holy Priest");
  assert.equal(
    specId("holy"),
    null,
    "ambiguous on its own, and stays that way",
  );
  assert.equal(specIdInClass("holy", holyPaladin), holyPaladin);
  assert.equal(specIdInClass("holy", holyPriest), holyPriest);
});

test("a spec name no spec of that class has resolves to nothing", () => {
  assert.equal(specIdInClass("frost", specId("Mistweaver Monk")), null);
  assert.equal(specIdInClass("windwalker", null), null);
  assert.equal(specIdInClass("", specId("Holy Paladin")), null);
});
