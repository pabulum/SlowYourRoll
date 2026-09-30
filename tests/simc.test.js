import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSimc } from "../src/simc.js";

const SAMPLE = `# Foo - Holy Priest
priest="Foo"
level=80
region=us
server=area-52
spec=holy

### Weekly Reward Choices
#
# Some Trinket (639)
# trinket1=,id=1111
#
# Another Item (639)
# head=,id=2222
#
### End of Weekly Reward Choices

head=,id=3333,ilevel=623
# Owned Helm (623)
# head=,id=3333

bonus_roll_items=a:b:c:d:4444/e:f:g:h:5555
`;

test("parseSimc extracts character identity", () => {
  const d = parseSimc(SAMPLE);
  assert.equal(d.name, "Foo");
  assert.equal(d.realm, "area-52");
  assert.equal(d.spec, "holy");
  assert.equal(d.region, "us");
});

test("parseSimc reads the weekly vault choices", () => {
  const d = parseSimc(SAMPLE);
  assert.equal(d.vault.length, 2);
  assert.deepEqual(
    d.vault.map((v) => v.id),
    [1111, 2222],
  );
  assert.equal(d.vault[0].ilvl, 639);
  // The addon puts a bare "#" between entries; it must not end up in the name.
  assert.deepEqual(
    d.vault.map((v) => v.name),
    ["Some Trinket", "Another Item"],
  );
});

test("parseSimc reads logged bonus rolls", () => {
  const d = parseSimc(SAMPLE);
  assert.deepEqual(d.rolledIds, [4444, 5555]);
});

test("parseSimc records owned copies but excludes the vault block", () => {
  const d = parseSimc(SAMPLE);
  assert.equal(d.owned[3333], 623);
  assert.equal(d.owned[1111], undefined); // vault items are not yet owned
});

// `slot_high_watermarks` is the only line in a /simc that describes upgrade state rather than
// possession, which is what the crest figure needs. Values are taken from a real 12.1 export.
test("parseSimc reads the per-slot high watermarks", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
spec=mistweaver
#
# slot_high_watermarks=0:298:298/1:298:298/2:289:289/3:289:289/4:308:308
#
`);
  assert.deepEqual(d.watermarks, [298, 298, 289, 289, 308]);
});

// The pair per slot is `character:account` — the two values GetHighWatermarkForSlot returns. QE's own
// sample export carries `14:0:89`, and an account's mark is the best across its characters, so it can
// never be the lower of the two: the 0 is the character's. That is the mark crests are discounted by
// (`accountWide: false`), and taking the higher would make a vault item look cheaper to finish.
test("a differing watermark pair resolves to the character's own mark", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
# slot_high_watermarks=0:0:89/1:321:334
`);
  assert.deepEqual(d.watermarks, [0, 321]);
});

// The index is the slot — Blizzard's ItemRedundancySlot, where 9 is both rings — so a mark has to
// land at its own index even when the line skips one, or every mark after the gap names the wrong slot.
test("watermarks are stored by the slot they name, with a gap left unknown", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
# slot_high_watermarks=0:334:334/2:321:321/9:321:321
`);
  assert.equal(d.watermarks[0], 334);
  assert.equal(d.watermarks[1], null, "unreported, so unknown — not zero");
  assert.equal(d.watermarks[2], 321);
  assert.equal(d.watermarks[9], 321);
});

// A real week-4 vault, read off an export: two Mythic-slot items handed over capped, three Heroic and
// M+ ones at the first step of Myth. Only the bonus ids tell those apart from Hero 5/6 at the same 318.
test("parseSimc reads each vault option's bonus ids", () => {
  const d = parseSimc(`monk="Handstamp"
server=tichondrius
### Weekly Reward Choices
#
# Soulcoiler Ritual Vessel (334)
# trinket1=,id=270162,bonus_id=6652/13335/12854
#
# Apex Brute's Claw Ring (318)
# finger1=,id=268252,bonus_id=6652/13668/13334/12849
#
### End of Weekly Reward Choices
`);
  assert.deepEqual(d.vault[0].bonus, [6652, 13335, 12854]);
  assert.deepEqual(d.vault[1].bonus, [6652, 13668, 13334, 12849]);
  assert.equal(d.vault[1].ilvl, 318);
});

test("a vault entry with no bonus ids reads as none rather than failing", () => {
  assert.deepEqual(parseSimc(SAMPLE).vault[0].bonus, []);
});

// What the character had to spend when the paste was made. Currencies only — the `i:` entries beside
// them are items — keyed by the id each season's tracks name as their crest.
test("parseSimc reads the crest balances the addon writes", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
# upgrade_currencies=c:1792:1600/c:3445:120/c:3446:10/i:232875:11
`);
  assert.deepEqual(d.currencies, { 1792: 1600, 3445: 120, 3446: 10 });
  assert.equal(
    parseSimc(SAMPLE).currencies,
    null,
    "and none where it wrote none",
  );
});

// Every export from before the addon wrote that line, and every hand-written fixture. The figure
// falls back to being quoted as a ceiling rather than the parse failing or inventing zeroes.
test("a paste with no watermark line reports none rather than empty slots", () => {
  assert.equal(parseSimc(SAMPLE).watermarks, null);
});

// The addon writes the loot spec commented out, because SimulationCraft ignores it. It is the only
// place either report format states what the game will actually award against, so it is read here.
test("parseSimc reads the in-game loot spec the addon comments out", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
spec=mistweaver
# loot_spec=windwalker
`);
  assert.equal(d.spec, "mistweaver");
  assert.equal(d.lootSpec, "windwalker");
});

test("an uncommented loot spec is read too, in case the addon stops commenting it", () => {
  const d = parseSimc(
    `monk="Bar"\nserver=tichondrius\nspec=mistweaver\nloot_spec=brewmaster\n`,
  );
  assert.equal(d.lootSpec, "brewmaster");
});

test("an export with no loot spec line reports none rather than guessing", () => {
  assert.equal(parseSimc(SAMPLE).lootSpec, null);
});

// Which track a copy you hold is on lives only in its bonus ids — 321 is Hero 6/6 or Myth 2/6 — so
// they're kept for the copy whose item level is kept, and dropped with it when a better one turns up.
test("parseSimc keeps the bonus ids of the best copy it records", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
# Alluring Bubbleband (308)
finger1=,id=268266,bonus_id=6652/13668/13334/12842
#
# Alluring Bubbleband (321)
# finger1=,id=268266,bonus_id=6652/13668/13334/12846
#
# Owned Helm (623)
# head=,id=3333
`);
  assert.equal(d.owned[268266], 321);
  assert.deepEqual(d.ownedBonus[268266], [6652, 13668, 13334, 12846]);
  assert.equal(d.ownedBonus[3333], undefined, "no bonus ids, none recorded");
});
