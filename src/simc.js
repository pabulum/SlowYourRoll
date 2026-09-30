// Parsing and linking of the in-game /simc addon export: this week's vault choices,
// logged bonus rolls, and the items the character already owns.

import { loadQEData, QE_DATA } from "./data.js";
import { $, toast } from "./dom.js";
import { render } from "./render.js";
import { charKeyOf, save, simcOf, state } from "./store.js";

/**
 * Parse a raw /simc export into
 * { name, realm, spec, lootSpec, region, vault, rolledIds, owned, ownedBonus, watermarks, currencies }.
 *   vault:      [{ name, ilvl, id, bonus }] this week's Great Vault choices
 *   rolledIds:  item ids the addon logged as already bonus-rolled
 *   owned:      { [itemId]: highestIlvlHeld } from equipped + bags (excludes the vault block)
 *   ownedBonus: { [itemId]: bonusIds } for that same best copy, which name its upgrade track
 *   lootSpec:   the character's in-game loot spec, which decides what a bonus roll can award
 *   watermarks: per-slot highest item level held, or null — see `parseWatermarks`
 *   currencies: { [currencyId]: amount } held when exported, or null — see `parseCurrencies`
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
    const re =
      /^#[ \t]*(.+?)[ \t]*\((\d+)\)[ \t]*\n#[ \t]*\w+=,id=(\d+)([^\n]*)/gm;
    for (const m of blk.matchAll(re)) {
      // The bonus ids are the only thing in the entry that says which upgrade track the option is
      // on — at ilvl 318 it could be Hero 5/6 or Myth 1/6, which top out five steps apart. See
      // `trackStep` in season.js.
      const bm = m[4].match(/bonus_id=([\d/]+)/);
      vault.push({
        name: m[1],
        ilvl: +m[2],
        id: +m[3],
        bonus: bm ? bm[1].split("/").map(Number).filter(Boolean) : [],
      });
    }
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
  // The best copy's bonus ids ride along beside it, because they are the only thing that says which
  // track that copy is on: a 321 is Hero 6/6 or Myth 2/6, and those are different items to compare a
  // roll against. See `trackStep` in season.js.
  const owned = {},
    ownedBonus = {},
    ore = /\((\d+)\)\s*\n#?\s*\w+=,id=(\d+)([^\n]*)/g;
  for (const om of ot.matchAll(ore)) {
    const il = +om[1],
      iid = +om[2];
    if (owned[iid] && il <= owned[iid]) continue;
    owned[iid] = il;
    const bm = om[3].match(/bonus_id=([\d/]+)/);
    if (bm) ownedBonus[iid] = bm[1].split("/").map(Number).filter(Boolean);
    else delete ownedBonus[iid];
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
    ownedBonus,
    watermarks: parseWatermarks(t),
    currencies: parseCurrencies(t),
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
 * Each entry is `slot:character:account` — the two values `C_ItemUpgrade.GetHighWatermarkForSlot`
 * returns, in that order. The order is settled by QE's own sample export, which carries `14:0:89`:
 * an account's mark is the best across its characters, so it can never sit *below* one of them, and
 * the 0 has to be this character's. That is the mark a crest step is discounted by (`accountWide:
 * false`), so it is the one kept. The two agree on every armor slot either real export carries.
 *
 * Stored by slot index, because the index is the slot: it is Blizzard's `Enum.ItemRedundancySlot`,
 * and `WATERMARK_SLOT` in classes.js says which item goes with which. A slot the line leaves out
 * stays a hole, which every reader treats as unknown rather than as zero.
 *
 * @param {string} t  The raw paste.
 * @returns {number[]|null}
 */
function parseWatermarks(t) {
  const m = t.match(/^#?\s*slot_high_watermarks=(\S+)/m);
  if (!m) return null;
  /** @type {number[]} */
  const out = [];
  m[1].split("/").forEach((rec) => {
    const p = rec.split(":").map(Number);
    if (p.length < 2 || p.some((n) => !Number.isInteger(n))) return;
    if (p[0] >= 0 && p[0] < 64) out[p[0]] = p[1];
  });
  // Filled rather than left sparse, so a missing slot survives the round trip through localStorage
  // as null — JSON has no holes.
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = null;
  return out.length ? out : null;
}

/**
 * The character's crest balances when the paste was made, off the addon's `upgrade_currencies` line,
 * as `{ currencyId: amount }`. Null where the paste has none.
 *
 * Entries are `c:<currency id>:<amount>` for currencies and `i:<item id>:<count>` for the upgrade
 * items beside them; only the currencies are kept, since the crests are what an upgrade is priced in.
 * Which id is which crest comes from the season's tracks (`Track.currency`).
 *
 * @param {string} t  The raw paste.
 * @returns {Record<number, number>|null}
 */
function parseCurrencies(t) {
  const m = t.match(/^#?\s*upgrade_currencies=(\S+)/m);
  if (!m) return null;
  /** @type {Record<number, number>} */
  const out = {};
  m[1].split("/").forEach((rec) => {
    const p = rec.split(":");
    const id = Number(p[1]),
      n = Number(p[2]);
    if (p[0] === "c" && Number.isInteger(id) && Number.isFinite(n)) out[id] = n;
  });
  return Object.keys(out).length ? out : null;
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
  // Filed per character, not per spec: see `charKeyOf`.
  const k = charKeyOf(d.name, d.realm, d.region);
  state.simc[k] = {
    vault: d.vault,
    rolledIds: d.rolledIds,
    owned: d.owned,
    ownedBonus: d.ownedBonus,
    watermarks: d.watermarks,
    currencies: d.currencies,
    name: d.name,
    realm: d.realm,
    region: d.region,
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
    if (charKeyOf(b.player, b.realm, b.region) === k) {
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
      : `Saved ${d.name}'s data. Now load their report`,
  );
}

/** Mark logged bonus-rolls as Rolled (only for items actually in this report's pools). */
export function applySimc(b) {
  const simc = simcOf(b);
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
      b.overlay[`${s[0]}:${s[1]}:${id}`] = "rolled";
    });
  });
}
