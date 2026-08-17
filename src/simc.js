// Parsing and linking of the in-game /simc addon export: this week's vault choices,
// logged bonus rolls, and the items the character already owns.

import { QE_DATA, loadQEData } from "./data.js";
import { state, save, keyOf } from "./store.js";
import { $, toast } from "./dom.js";
import { render } from "./render.js";

/**
 * Parse a raw /simc export into
 * { name, realm, spec, lootSpec, region, vault, rolledIds, owned, watermarks }.
 *   vault:      [{ name, ilvl, id }] this week's Great Vault choices
 *   rolledIds:  item ids the addon logged as already bonus-rolled
 *   owned:      { [itemId]: highestIlvlHeld } from equipped + bags (excludes the vault block)
 *   lootSpec:   the character's in-game loot spec, which decides what a bonus roll can award
 *   watermarks: per-slot highest item level held, or null — see `parseWatermarks`
 */
export function parseSimc(t) {
  const g = (re) => {
    const m = t.match(re);
    return m ? m[1].trim() : null;
  };
  const name = g(/^\s*[a-z_]+="([^"]+)"/m),
    realm = g(/^server=(.+)$/m),
    spec = g(/^spec=(.+)$/m),
    region = g(/^region=(.+)$/m);

  // The addon writes the loot spec commented out, because SimulationCraft has no use for it —
  // `# loot_spec=windwalker` on the line after `spec=mistweaver`. This app has every use for it:
  // loot spec is what Blizzard actually awards against, so it decides the pool and the ranking.
  // Matched with the `#` optional, in case the addon ever stops commenting it.
  const lootSpec = g(/^#?\s*loot_spec=(.+)$/m);

  const vault = [],
    vb = t.indexOf("### Weekly Reward Choices");
  if (vb >= 0) {
    const ve = t.indexOf("### End of Weekly Reward Choices", vb);
    const blk = t.slice(vb, ve < 0 ? t.length : ve);
    // Horizontal whitespace only, anchored per line: the addon separates entries with a bare "#"
    // line, and an `\s*` that can cross a newline swallows it into the next entry's name.
    const re = /^#[ \t]*(.+?)[ \t]*\((\d+)\)[ \t]*\n#[ \t]*\w+=,id=(\d+)/gm;
    let m;
    while ((m = re.exec(blk)))
      vault.push({ name: m[1], ilvl: +m[2], id: +m[3] });
  }

  const rolledIds = [],
    rm = t.match(/bonus_roll_items=(\S+)/);
  if (rm) {
    rm[1].split("/").forEach((rec) => {
      const p = rec.split(":");
      if (p.length >= 5) {
        const id = parseInt(p[4], 10);
        if (id) rolledIds.push(id);
      }
    });
  }

  // Owned copies (equipped + bags), id -> highest ilvl held. The vault block is excluded (not yet owned).
  let ot = t;
  if (vb >= 0) {
    const oe = t.indexOf("### End of Weekly Reward Choices", vb);
    ot = t.slice(0, vb) + (oe >= 0 ? t.slice(oe) : "");
  }
  const owned = {},
    ore = /\((\d+)\)\s*\n#?\s*\w+=,id=(\d+)/g;
  let om;
  while ((om = ore.exec(ot))) {
    const il = +om[1],
      iid = +om[2];
    if (!owned[iid] || il > owned[iid]) owned[iid] = il;
  }

  return {
    name,
    realm,
    spec,
    lootSpec,
    region,
    vault,
    rolledIds,
    owned,
    watermarks: parseWatermarks(t),
  };
}

/**
 * The highest item level this character has held in each equipment slot, off the addon's
 * `slot_high_watermarks` line. Null where the paste has none — every export before this line existed,
 * and any hand-written fixture.
 *
 * This is the only thing in a /simc paste that describes *upgrade* state rather than possession, and
 * it is what the crest figure needs: Blizzard charges crests only for the steps that take an item
 * above its slot's watermark, so a slot already up a track has had part of that cost paid. QE's
 * `BonusIDs.ts` records the rule as `highWatermarkDiscounts` — crest currencies carry `scaling: 0`
 * at or below the mark, i.e. free, and `accountWide: false`, so it is the character's own mark that
 * counts. Read the Midnight entries there (`seasonId: 37`) rather than the TWW ones that fill most
 * of that file: TWW charged Valorstones alongside crests, and Valorstones no longer exist.
 *
 * Each entry is `slot:a:b`, and the two figures differ in the wild (QE's own sample has `14:0:89`),
 * which reads as character mark and account mark — the same split `highWatermarkDiscounts` draws with
 * `accountWide`. Which is which isn't established here, so this takes the **higher** of the pair
 * deliberately: a higher mark means more of a track already paid for, which means a *smaller* crest
 * saving, so guessing wrong this way understates what a roll is worth rather than overstating it.
 *
 * The slot indices are left as they arrive. They look like SimC's slot enum but don't survive being
 * checked against a real character's gear — see "What the crest figure assumes" in the README — so
 * nothing here maps an index to a slot, and nothing downstream may either. The array is used only
 * for questions that don't need to know which slot is which.
 *
 * @param {string} t  The raw paste.
 * @returns {number[]|null}
 */
function parseWatermarks(t) {
  const m = t.match(/^#?\s*slot_high_watermarks=(\S+)/m);
  if (!m) return null;
  const out = [];
  m[1].split("/").forEach((rec) => {
    const p = rec.split(":").map(Number);
    if (p.length < 2 || p.some((n) => !Number.isFinite(n))) return;
    out.push(Math.max(...p.slice(1)));
  });
  return out.length ? out : null;
}

/** Read the /simc textarea, store the parsed data, and link it to any matching board. */
export async function readSimc() {
  const t = $("simcInput").value || "";
  const d = parseSimc(t);
  if (!d.name || !d.realm) {
    toast("Couldn't find a character in that /simc text");
    return;
  }
  // applySimc() below reads the item database. Same memoized wait as reports.js: normally settled
  // long before anyone has pasted their /simc dump.
  try {
    await loadQEData();
  } catch {
    toast(
      "Couldn't load the encounter database. Check your connection and try again",
    );
    return;
  }
  const k = keyOf(d.name, d.realm, d.spec);
  state.simc[k] = {
    vault: d.vault,
    rolledIds: d.rolledIds,
    owned: d.owned,
    watermarks: d.watermarks,
    name: d.name,
    realm: d.realm,
    spec: d.spec,
    lootSpec: d.lootSpec,
    // When this was read, which only the vault half of it needs. Owned gear and logged rolls stay
    // true until the next paste replaces them; a vault is three options that vanish at the weekly
    // reset, and without a date on it the app cannot tell this week's from last season's. See
    // `vaultStatus` in model.js.
    at: new Date().toISOString(),
  };
  let applied = false;
  state.boards.forEach((b) => {
    if (b.key === k) {
      applySimc(b);
      applied = true;
    }
  });
  save();
  render();
  $("simcInput").value = "";
  $("simcBox").open = false;
  toast(
    applied
      ? "Linked to " +
          d.name +
          ": " +
          d.vault.length +
          " vault options, " +
          d.rolledIds.length +
          " logged rolls"
      : "Saved " + d.name + "'s data. Now load their report",
  );
}

/** Mark logged bonus-rolls as Rolled (only for items actually in this report's pools). */
export function applySimc(b) {
  const simc = state.simc[b.key];
  if (!simc) return;
  const repIds = {};
  b.results.forEach((r) => {
    repIds[r.item] = 1;
  });
  (simc.rolledIds || []).forEach((id) => {
    if (!repIds[id]) return;
    const meta = QE_DATA.items[id];
    if (!meta) return;
    meta.s.forEach((s) => {
      b.overlay[s[0] + ":" + s[1] + ":" + id] = "rolled";
    });
  });
}
