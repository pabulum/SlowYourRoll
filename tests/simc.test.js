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
