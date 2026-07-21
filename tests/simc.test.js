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
# Some Trinket (639)
# trinket1=,id=1111
# Another Item (639)
# head=,id=2222
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
  assert.deepEqual(d.vault.map((v) => v.id), [1111, 2222]);
  assert.equal(d.vault[0].ilvl, 639);
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
