// Shared JSDoc type definitions. This file has no runtime exports — importing its
// typedefs is done with `@typedef {import("./types.js").Name}` where needed.

/**
 * A single item in the encounter database.
 * `s` lists the sources that drop it: [instId, encId] or [instId, encId, veryRare].
 * @typedef {Object} Item
 * @property {string} n  Item name.
 * @property {number} q  Quality (2 uncommon … 5 legendary).
 * @property {Array<number[]>} s  Sources: each [instId, encId] with an optional 3rd "very rare" flag.
 * @property {number} [c]   Item class (2 weapon, 4 armor).
 * @property {number} [u]   Item subclass — armor type: 1 cloth, 2 leather, 3 mail, 4 plate, 6 shield.
 * @property {number} [iv]  Inventory slot (16 = Back; cloaks are filed as cloth but worn by all).
 * @property {string} [st]  Primary stats it can roll, as a code set: "i" intellect, "ai" the
 *   agility-or-intellect of leather and mail, "si" plate, "" none (jewelry and cloaks).
 * @property {number[]} [p]  Spec ids Blizzard allows this to drop for. Absent = unrestricted.
 * @property {string} [ic]  Blizzard icon name, for the icon CDN and the hover card.
 * @property {string} [sc]  Secondary stats, biggest first: "c" crit, "h" haste, "v" vers, "m" mastery.
 */

/**
 * A playable spec, keyed by Blizzard's spec id.
 * @typedef {Object} Spec
 * @property {string} n   Spec name ("Mistweaver").
 * @property {string} c   Class name ("Monk").
 * @property {string} st  Primary stat ("int"/"agi"/"str"), inferred at build time; "" if unknown.
 */

/**
 * The full encounter + item database (data/qe-data.json).
 * @typedef {Object} QEData
 * @property {Record<string, { name: string, bosses: Record<string, string> }>} raids
 * @property {Record<string, string>} dungeons
 * @property {string[]} currentRaids
 * @property {string[]} currentDungeons
 * @property {string[]} [ignoredInstances] Instances items reference that aren't bonus-roll sources
 *   (world bosses, leveling drops, catch-up vendors). Recorded so the app can drop them knowingly
 *   and still warn about instances it has genuinely never heard of.
 * @property {{ note: string, source: string, qeSeasonId: number }} [_meta]  Build provenance. JSON
 *   can't carry the comment header the old .js blob had, so it rides along as data instead. Nothing
 *   reads it at runtime; scripts/build-data.mjs drops it before comparing for drift.
 * @property {number} [seasonId]  QE Live's CONSTANTS.seasonID at build time; see src/season.js.
 * @property {Record<string, Spec>} [specs]  Spec id -> name/class/primary stat; see src/loot.js.
 * @property {Record<string, Item>} items
 */

/**
 * One result row from a loaded report. QE and Droptimizer reports populate different
 * subsets of these fields.
 * @typedef {Object} Result
 * @property {number} item   Item id.
 * @property {number} score  On a Droptimizer, the DPS gain. On a QE report, whichever metric the
 *   person who ran it had selected, so not safe to read directly — see `scoreOf` in src/model.js.
 * @property {number} [rawDiff]  QE: the HPS gained, whatever that report's metric setting was.
 * @property {number} [percDiff] QE: the same gain as a percentage of the character's HPS.
 * @property {number} [level] Item level of the drop.
 * @property {string|number} [dropDifficulty] QE difficulty, an index into QE_RAID_DIFFICULTIES.
 * @property {string} [dropLoc] QE source category ("Raid", "Dungeon", "Crafted", "Delves").
 * @property {number} [inst]  Droptimizer instance id.
 * @property {number} [enc]   Droptimizer encounter id.
 * @property {string} [diff]  Droptimizer difficulty.
 * @property {number} [rawDelta] Droptimizer raw DPS delta (may be negative).
 */

/**
 * A loaded character report and all per-character UI state. Extra transient fields
 * (prefixed `_`) are view-only and never persisted meaningfully.
 * @typedef {Object} Board
 * @property {string} id
 * @property {string} key                 Identity key (name~realm~spec).
 * @property {string} reportId
 * @property {string} player
 * @property {string} realm
 * @property {string} [region]
 * @property {string} spec
 * @property {"qe"|"droptimizer"} source
 * @property {Result[]} results
 * @property {Object<string, "own"|"rolled">} overlay     Manual per-item state overrides.
 * @property {Object<string, number>} tokenOverride        Per-encounter token cost overrides.
 * @property {number|null} vaultTake      Item id being taken from the vault, if any.
 * @property {number} [tokenRaid]         Legacy; token costs now come from src/season.js.
 * @property {number} [tokenDungeon]      Legacy; token costs now come from src/season.js.
 * @property {string|number|null} raidDiff Selected raid difficulty.
 * @property {string|null} [lootSpec]     Spec id to be looted as; null follows the report's spec.
 * @property {"raw"|"pct"} [metric]        Raw throughput or a percentage of the character's own.
 * @property {number} [baseline]           Droptimizer baseline DPS. A QE board has none stored;
 *   `baselineOf` recovers its HPS equivalent from the report's own numbers.
 * @property {Object<number, number>} [equipped]  Gear worn when a QE report ran, itemId -> ilvl.
 * @property {string} [fetchedAt]
 * @property {string} [gameType]
 * @property {string} [contentType]
 * @property {string} [unit]               Legacy; the unit now follows the report's source.
 * @property {Object} [ufSettings]
 * @property {string|null} [_open]         Currently expanded encounter key.
 * @property {string|null} [_showBlockedKey] Encounter whose ineligible items are revealed.
 */

/**
 * Parsed /simc addon data for one character.
 * @typedef {Object} SimcData
 * @property {{ name: string, ilvl: number, id: number }[]} vault
 * @property {number[]} rolledIds
 * @property {Object<number, number>} owned  itemId -> highest ilvl held.
 * @property {string} [name]
 * @property {string} [realm]
 * @property {string} [spec]
 * @property {string|null} [lootSpec]  The loot spec set in game, which is what a bonus roll is
 *   actually awarded against. Often not the spec the report was simmed as.
 */

/**
 * A resolved item within a pool, ready to render.
 * @typedef {Object} PoolItem
 * @property {number} id
 * @property {string} name
 * @property {number} q
 * @property {number} score
 * @property {number} [lvl]  Item level this source drops it at — what the report simmed.
 * @property {number|null} [rollIlvl]  Item level a bonus roll would actually hand you. Equal to
 *   `lvl` in a season that pays out at the drop; null when the season promotes the reward to a
 *   vault track whose item level isn't known yet. See src/season.js.
 * @property {boolean} [dupe]  You already hold this at or above `rollIlvl`, so a roll adds nothing.
 * @property {boolean} vr
 * @property {number|null} [ownedIlvl]
 * @property {"want"|"own"|"rolled"} [state]
 * @property {boolean} [elig]        False when this loot spec can't be awarded the item.
 * @property {string} [why]          Why not, for the UI.
 * @property {string[]|null} [swap]  Specs of the same class that could take it, if any.
 * @property {string[]} [specs]      Spec ids of this character's class that can be awarded it.
 */

/**
 * An encounter grouping and its ranked pool.
 * @typedef {Object} Row
 * @property {{ key: string, type: "raid"|"dungeon", name: string, instName: string,
 *   special?: boolean }} g  `special` marks an end-of-raid encounter carrying the season's top tier.
 * @property {PoolItem[]} items
 * @property {number} remaining
 * @property {number} num
 * @property {number} cost
 * @property {number} ev
 * @property {number} nWant
 * @property {import("./season.js").Reward|null} [reward]  Upgrade track a roll here pays out at;
 *   null when the season simply hands you the drop.
 * @property {number} [nBlocked]  Items shown but out of the pool: this loot spec can't receive them.
 * @property {{spec: string, remaining: number, num: number, ev: number, dodges: string[],
 *   gains: string[], loses: string[]}[]} [alts]  Better-EV loot specs for this encounter.
 */

export {};
