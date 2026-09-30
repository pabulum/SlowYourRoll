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

/**
 * Which of a character's high watermarks an item's upgrades are discounted by, keyed by the item's
 * inventory type (`iv` in the database) — the index into a `/simc`'s `slot_high_watermarks` line.
 *
 * That line is Blizzard's `C_ItemUpgrade.GetHighWatermarkForSlot` run over `Enum.ItemRedundancySlot`,
 * not one entry per equipment slot, which is why it has seventeen entries and why an earlier reading
 * of them as SimC's slot list never fitted real gear:
 *
 *   0 Head · 1 Neck · 2 Shoulder · 3 Chest · 4 Waist · 5 Legs · 6 Feet · 7 Wrist · 8 Hand
 *   9 Finger · 10 Trinket · 11 Cloak · 12 Twohand · 13 MainhandWeapon · 14 OnehandWeapon
 *   15 OnehandWeaponSecond · 16 Offhand
 *
 * Checked against two real 12.1 exports, the user's and QE Live's own sample: every armor, jewelry
 * and cloak index is at or above the item held in that slot, where SimC's order puts a 308 mark under
 * a 321 chest. Two things follow that the old reading got wrong. Rings share one mark, and so do
 * trinkets — QE's sample holds trinkets at 334 and 344 and reports 334, the lower of the pair, so a
 * second ring is discounted by the worse of the two you wear. And the weapons are split by kind of
 * weapon rather than by hand.
 *
 * Only what those exports pin down is mapped. Two-handers and held-in-off-hand items were checked;
 * shields sit in the same enum entry as the latter. One-handers and main-hand-only weapons are left
 * out: neither export's marks for those three entries line up with the one-handers held clearly
 * enough to say which is which, and a slot this can't name is priced at the season's assumption
 * rather than at a guessed mark.
 */
export const WATERMARK_SLOT = {
  1: 0, // head
  2: 1, // neck
  3: 2, // shoulder
  5: 3, // chest
  20: 3, // robe
  6: 4, // waist
  7: 5, // legs
  8: 6, // feet
  9: 7, // wrist
  10: 8, // hands
  11: 9, // finger — one mark for both rings
  12: 10, // trinket — one mark for both
  16: 11, // back
  17: 12, // two-hand
  14: 16, // shield
  23: 16, // held in off-hand
};

/** What to call each of those slots in a sentence, by the same index. */
export const WATERMARK_NAME = [
  "head",
  "neck",
  "shoulder",
  "chest",
  "waist",
  "legs",
  "feet",
  "wrist",
  "hands",
  "ring",
  "trinket",
  "back",
  "two-hand",
  "main hand",
  "one-hand",
  "second one-hand",
  "off-hand",
];

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
