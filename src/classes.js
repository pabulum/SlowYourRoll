// What each class can wear and wield.
//
// Blizzard's item data lists specs only where a drop is restricted, which is a small minority of
// items — everything else is governed by these rules plus the item's primary stat. They're game
// constants, not season data, so they're hand-written here rather than generated: deriving them
// from the item database was tried and doesn't work, because the spec lists that do exist are
// dominated by two decades of legacy items (they claim priests can loot bows).
//
// Subclass ids are Blizzard's own. Armor: 1 cloth, 2 leather, 3 mail, 4 plate, 6 shield.

/** Armor subclass each class wears. */
export const CLASS_ARMOR = {
  Mage: 1,
  Priest: 1,
  Warlock: 1,
  Druid: 2,
  Monk: 2,
  Rogue: 2,
  "Demon Hunter": 2,
  Hunter: 3,
  Shaman: 3,
  Evoker: 3,
  "Death Knight": 4,
  Paladin: 4,
  Warrior: 4,
};

export const ARMOR_NAME = {
  1: "Cloth",
  2: "Leather",
  3: "Mail",
  4: "Plate",
  6: "Shield",
};

/** Blizzard's own class colours — used as a swatch so a character reads at a glance. */
export const CLASS_COLOR = {
  "Death Knight": "#c41e3a",
  "Demon Hunter": "#a330c9",
  Druid: "#ff7c0a",
  Evoker: "#33937f",
  Hunter: "#aad372",
  Mage: "#3fc7eb",
  Monk: "#00ff98",
  Paladin: "#f48cba",
  Priest: "#ffffff",
  Rogue: "#fff468",
  Shaman: "#0070dd",
  Warlock: "#8788ee",
  Warrior: "#c69b6d",
};

/** Classes that can equip a shield. */
export const SHIELD_CLASSES = ["Paladin", "Shaman", "Warrior"];

/** Weapon subclasses each class is trained in. */
export const CLASS_WEAPONS = {
  "Death Knight": [0, 1, 4, 5, 6, 7, 8],
  "Demon Hunter": [0, 7, 9, 13, 15],
  Druid: [4, 5, 6, 10, 13, 15],
  Evoker: [0, 1, 4, 5, 7, 8, 10, 13, 15],
  Hunter: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 18],
  Mage: [7, 10, 15, 19],
  Monk: [0, 4, 6, 7, 10, 13],
  Paladin: [0, 1, 4, 5, 6, 7, 8],
  Priest: [4, 10, 15, 19],
  Rogue: [0, 4, 7, 13, 15],
  Shaman: [0, 1, 4, 5, 10, 13, 15],
  Warlock: [7, 10, 15, 19],
  Warrior: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 18],
};

export const WEAPON_NAME = {
  0: "One-handed axe",
  1: "Two-handed axe",
  2: "Bow",
  3: "Gun",
  4: "One-handed mace",
  5: "Two-handed mace",
  6: "Polearm",
  7: "One-handed sword",
  8: "Two-handed sword",
  9: "Warglaive",
  10: "Staff",
  13: "Fist weapon",
  15: "Dagger",
  18: "Crossbow",
  19: "Wand",
};
