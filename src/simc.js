// Parsing and linking of the in-game /simc addon export: this week's vault choices,
// logged bonus rolls, and the items the character already owns.

import { QE_DATA } from "./data.js";
import { state, save, keyOf } from "./store.js";
import { $, toast } from "./util.js";
import { render } from "./render.js";

/**
 * Parse a raw /simc export into { name, realm, spec, region, vault, rolledIds, owned }.
 *   vault:     [{ name, ilvl, id }] this week's Great Vault choices
 *   rolledIds: item ids the addon logged as already bonus-rolled
 *   owned:     { [itemId]: highestIlvlHeld } from equipped + bags (excludes the vault block)
 */
export function parseSimc(t) {
  const g = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
  const name = g(/^\s*[a-z_]+="([^"]+)"/m), realm = g(/^server=(.+)$/m),
    spec = g(/^spec=(.+)$/m), region = g(/^region=(.+)$/m);

  const vault = [], vb = t.indexOf("### Weekly Reward Choices");
  if (vb >= 0) {
    const ve = t.indexOf("### End of Weekly Reward Choices", vb);
    const blk = t.slice(vb, ve < 0 ? t.length : ve);
    // Horizontal whitespace only, anchored per line: the addon separates entries with a bare "#"
    // line, and an `\s*` that can cross a newline swallows it into the next entry's name.
    const re = /^#[ \t]*(.+?)[ \t]*\((\d+)\)[ \t]*\n#[ \t]*\w+=,id=(\d+)/gm;
    let m;
    while ((m = re.exec(blk))) vault.push({ name: m[1], ilvl: +m[2], id: +m[3] });
  }

  const rolledIds = [], rm = t.match(/bonus_roll_items=(\S+)/);
  if (rm) {
    rm[1].split("/").forEach((rec) => {
      const p = rec.split(":");
      if (p.length >= 5) { const id = parseInt(p[4], 10); if (id) rolledIds.push(id); }
    });
  }

  // Owned copies (equipped + bags), id -> highest ilvl held. The vault block is excluded (not yet owned).
  let ot = t;
  if (vb >= 0) {
    const oe = t.indexOf("### End of Weekly Reward Choices", vb);
    ot = t.slice(0, vb) + (oe >= 0 ? t.slice(oe) : "");
  }
  const owned = {}, ore = /\((\d+)\)\s*\n#?\s*\w+=,id=(\d+)/g;
  let om;
  while ((om = ore.exec(ot))) {
    const il = +om[1], iid = +om[2];
    if (!owned[iid] || il > owned[iid]) owned[iid] = il;
  }

  return { name, realm, spec, region, vault, rolledIds, owned };
}

/** Read the /simc textarea, store the parsed data, and link it to any matching board. */
export function readSimc() {
  const t = $("simcInput").value || "";
  const d = parseSimc(t);
  if (!d.name || !d.realm) { toast("Couldn't find a character in that /simc text"); return; }
  const k = keyOf(d.name, d.realm, d.spec);
  state.simc[k] = { vault: d.vault, rolledIds: d.rolledIds, owned: d.owned, name: d.name, realm: d.realm, spec: d.spec };
  let applied = false;
  state.boards.forEach((b) => { if (b.key === k) { applySimc(b); applied = true; } });
  save(); render();
  $("simcInput").value = "";
  $("simcBox").open = false;
  toast(applied
    ? ("Linked to " + d.name + " — " + d.vault.length + " vault, " + d.rolledIds.length + " logged rolls")
    : ("Saved " + d.name + "'s data — now load their QE report"));
}

/** Mark logged bonus-rolls as Rolled (only for items actually in this report's pools). */
export function applySimc(b) {
  const simc = state.simc[b.key];
  if (!simc) return;
  const repIds = {};
  b.results.forEach((r) => { repIds[r.item] = 1; });
  (simc.rolledIds || []).forEach((id) => {
    if (!repIds[id]) return;
    const meta = QE_DATA.items[id];
    if (!meta) return;
    meta.s.forEach((s) => { b.overlay[s[0] + ":" + s[1] + ":" + id] = "rolled"; });
  });
}
