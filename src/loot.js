// Who can actually loot what.
//
// A bonus roll draws from the pool your *loot spec* is eligible for, so an item you can't receive
// isn't a near miss — it isn't in the pool at all, and counting it understates every encounter's
// EV. Two sources of truth, in order:
//
//   1. Blizzard's own spec list (`p` on an item). Present only where a drop is restricted, but
//      authoritative when it is — it's what separates a healer trinket from the caster-DPS one
//      sharing its slot, stat and boss.
//   2. Armor type and primary stat. Covers the unrestricted majority: a Monk can't receive plate,
//      and a Mistweaver can't receive the agility leather its Windwalker sibling rolls for.
//
// Anything we can't judge is left lootable. Wrongly hiding an item costs the user a roll they
// should have made; wrongly showing one only dilutes a number they can see.

import { QE_DATA } from "./data.js";
import { CLASS_ARMOR, ARMOR_NAME, SHIELD_CLASSES, CLASS_WEAPONS, WEAPON_NAME } from "./classes.js";

// An item's `st` is the set of primary stats it can roll, as a code string: "i" is intellect only,
// "ai" the agility-or-intellect that every leather and mail drop is. A spec takes exactly one.
const STAT_CODE = { agi: "a", str: "s", int: "i" };
const STAT_NAME = { a: "Agility", s: "Strength", i: "Intellect" };

/** "Agility or Intellect" — how to describe an item's possible stats in a sentence. */
export function statLabel(set) {
  const names = String(set || "").split("").map((ch) => STAT_NAME[ch]).filter(Boolean);
  return names.length > 1 ? names.slice(0, -1).join(", ") + " or " + names[names.length - 1] : (names[0] || "");
}
const BACK = 16; // inventoryType: cloaks are filed as cloth but everyone wears them

/** "Leather" / "Warglaive" — what kind of gear this is, where we know. */
export function gearLabel(item) {
  if (!item) return "";
  if (item.c === 4 && item.iv !== BACK) return ARMOR_NAME[item.u] || "";
  if (item.c === 2) return WEAPON_NAME[item.u] || "Weapon";
  return "";
}

/** Normalize a spec name for matching: "Mistweaver Monk" / "mistweaver" -> "mistweaver". */
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Resolve a report's spec string to a spec id. QE sends "Mistweaver Monk"; a Droptimizer's simc
 * input sends "mistweaver". Returns null when the name is missing or ambiguous ("holy" is both a
 * priest and a paladin) — callers then skip eligibility entirely rather than guess a class.
 * @param {string} spec
 * @returns {string|null}
 */
export function specId(spec) {
  const want = norm(spec);
  if (!want) return null;
  const all = QE_DATA.specs || {};
  const hits = Object.keys(all).filter((id) => {
    const s = all[id];
    return want === norm(s.n) || want === norm(s.n + s.c) || want === norm(s.c + s.n);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** The spec record for an id, or null. */
export function specInfo(id) {
  return (id && (QE_DATA.specs || {})[id]) || null;
}

/** Every spec of the same class, in id order. */
export function classSpecs(id) {
  const me = specInfo(id);
  if (!me) return [];
  const all = QE_DATA.specs || {};
  return Object.keys(all).filter((k) => all[k].c === me.c);
}

/**
 * Can `spec` receive `item`? `why` names the blocker for the UI; `swap` lists the specs of the same
 * class that *could* take it, which is the only case where changing loot spec would help.
 * @param {Partial<import("./types.js").Item>} item
 * @param {string|null} spec  Spec id from specId().
 * @returns {{ ok: boolean, why?: string, swap?: string[] }}
 */
export function canLoot(item, spec) {
  const me = specInfo(spec);
  if (!item || !me) return { ok: true }; // unknown spec, or an item with no loot facts — don't filter
  if (allows(item, spec)) return { ok: true };

  // Blocked. Whether a sibling spec could take it is the whole difference between "wrong class,
  // forget it" and "swap loot spec and roll again", so it's worth the second pass.
  const others = classSpecs(spec).filter((k) => k !== spec && allows(item, k)).map((k) => specInfo(k).n);
  if (item.p) {
    return others.length
      ? { ok: false, why: others.join(" / ") + " only", swap: others }
      : { ok: false, why: "No " + me.c + " spec can loot this" };
  }
  const armor = CLASS_ARMOR[me.c];
  if (item.c === 4 && item.u === 6) return { ok: false, why: me.c + "s can't use shields" };
  if (item.c === 4 && item.u >= 1 && item.u <= 4 && item.u !== armor && item.iv !== BACK) {
    return { ok: false, why: (ARMOR_NAME[item.u] || "Armor") + " — " + me.c + " wears " + ARMOR_NAME[armor] };
  }
  if (item.c === 2 && !weaponOk(item, me.c)) {
    return { ok: false, why: (WEAPON_NAME[item.u] || "Weapon") + " — not a " + me.c + " weapon" };
  }
  return others.length
    ? { ok: false, why: statLabel(item.st) + " — " + others.join(" / ") + " only", swap: others }
    : { ok: false, why: statLabel(item.st) + " item" };
}

/**
 * The bare predicate behind canLoot, with no explanation and no sibling lookup — so canLoot can ask
 * it about a class's other specs without recursing back into itself.
 * @param {Partial<import("./types.js").Item>} item
 * @param {string} spec
 */
function allows(item, spec) {
  const me = specInfo(spec);
  if (!me) return true;
  // 1. An explicit spec list settles it outright.
  if (item.p) return item.p.indexOf(Number(spec)) >= 0;
  // 2. Armor type. Cloaks (Back) and jewelry (subclass 0) are worn by everyone.
  if (item.c === 4 && item.u === 6) return SHIELD_CLASSES.indexOf(me.c) >= 0;
  if (item.c === 4 && item.iv !== BACK && item.u >= 1 && item.u <= 4 && item.u !== CLASS_ARMOR[me.c]) return false;
  // 3. Weapon training. A warglaive is a demon hunter's or nobody's.
  if (item.c === 2 && !weaponOk(item, me.c)) return false;
  // 4. Primary stat: the line between a class's own specs. A flexible item (leather rolls agility
  //    *or* intellect) satisfies every spec that takes one of them.
  return !(item.st && me.st && item.st.indexOf(STAT_CODE[me.st]) < 0);
}

/** Is this weapon one the class is trained in? Unknown class or subclass: assume yes. */
function weaponOk(item, cls) {
  const list = CLASS_WEAPONS[cls];
  if (!list || item.u == null || !WEAPON_NAME[item.u]) return true;
  return list.indexOf(item.u) >= 0;
}
