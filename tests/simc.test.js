import { test } from "node:test";
import assert from "node:assert/strict";
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

// The pair per slot is not always equal — QE's own sample export carries `14:0:89` — and which of
// the two is the character's own mark isn't established. The higher is taken on purpose: a higher
// mark means more of a track already paid for, so it can only shrink the crest saving claimed. If
// the guess is wrong it undersells a roll, which is the safe direction to be wrong in.
test("a differing watermark pair resolves to the higher of the two", () => {
  const d = parseSimc(`monk="Bar"
server=tichondrius
# slot_high_watermarks=0:0:89/1:334:200
`);
  assert.deepEqual(d.watermarks, [89, 334]);
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
