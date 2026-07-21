// Shared JSDoc type definitions. This file has no runtime exports — importing its
// typedefs is done with `@typedef {import("./types.js").Name}` where needed.

/**
 * A single item in the encounter database.
 * `s` lists the sources that drop it: [instId, encId] or [instId, encId, veryRare].
 * @typedef {Object} Item
 * @property {string} n  Item name.
 * @property {number} q  Quality (2 uncommon … 5 legendary).
 * @property {Array<number[]>} s  Sources: each [instId, encId] with an optional 3rd "very rare" flag.
 */

/**
 * The full encounter + item database (data/qe-data.js).
 * @typedef {Object} QEData
 * @property {Record<string, { name: string, bosses: Record<string, string> }>} raids
 * @property {Record<string, string>} dungeons
 * @property {string[]} currentRaids
 * @property {string[]} currentDungeons
 * @property {string[]} [ignoredInstances] Instances items reference that aren't bonus-roll sources
 *   (world bosses, leveling drops, catch-up vendors). Recorded so the app can drop them knowingly
 *   and still warn about instances it has genuinely never heard of.
 * @property {number} [seasonId]  QE Live's CONSTANTS.seasonID at build time; see src/season.js.
 * @property {Record<string, Item>} items
 */

/**
 * One result row from a loaded report. QE and Droptimizer reports populate different
 * subsets of these fields.
 * @typedef {Object} Result
 * @property {number} item   Item id.
 * @property {number} score  Value (QE score or DPS gain), never negative.
 * @property {number} [level] Item level of the drop.
 * @property {string|number} [dropDifficulty] QE difficulty.
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
 * @property {"raw"|"pct"} [metric]        Droptimizer display metric.
 * @property {number} [baseline]           Droptimizer baseline DPS.
 * @property {string} [fetchedAt]
 * @property {string} [gameType]
 * @property {string} [contentType]
 * @property {string} [unit]
 * @property {Object} [ufSettings]
 * @property {string|null} [_open]         Currently expanded encounter key.
 * @property {string|null} [_showZeroKey]  Encounter whose zero-score fillers are revealed.
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
 */

/**
 * A resolved item within a pool, ready to render.
 * @typedef {Object} PoolItem
 * @property {number} id
 * @property {string} name
 * @property {number} q
 * @property {number} score
 * @property {number} [lvl]
 * @property {boolean} vr
 * @property {number|null} [ownedIlvl]
 * @property {"want"|"own"|"rolled"} [state]
 */

/**
 * An encounter grouping and its ranked pool.
 * @typedef {Object} Row
 * @property {{ key: string, type: "raid"|"dungeon", name: string, instName: string }} g
 * @property {PoolItem[]} items
 * @property {number} remaining
 * @property {number} num
 * @property {number} cost
 * @property {number} ev
 * @property {number} nWant
 */

export {};
