#!/usr/bin/env node

// Regenerates data/qe-data.json from a local QuestionablyEpic checkout.
//
//   npm run data                          # uses $QE_PATH, else ~/Projects/QuestionablyEpic
//   npx prettier --write data/qe-data.json # then this — the committed file is prettier-formatted,
//                                          # and skipping it reformats every line into a diff that
//                                          # buries whatever actually changed
//   npm run data -- --qe=/path/to/QELive  # explicit checkout
//   npm run data:check                    # rebuild in memory and report drift, writing nothing
//
// Upstream sources, all inside the QE checkout:
//   src/General/Engine/CONSTANTS.ts  currentRaidIDs, currentDungeonIDs, seasonID
//   src/Databases/InstanceDB.ts      encounterDB (raids + bosses + bossOrder), the "-1" dungeon map,
//                                    instanceDB (display names for instances with no boss list).
//                                    Was InstanceDB.js until QE's 12.1 branch; both names are tried.
//   src/Databases/ItemDB.json        items: id, name, quality, sources[{instanceId, encounterId, veryRare}]
//
// Season rollover is entirely a CONSTANTS.ts change upstream: when QE flips currentRaidIDs /
// currentDungeonIDs to Season 2, rerun this and commit the result. Nothing here is hand-maintained.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/qe-data.json");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const qeArg = argv.find((a) => a.startsWith("--qe="));
const QE = qeArg
  ? qeArg.slice(5)
  : process.env.QE_PATH || join(homedir(), "Projects/QuestionablyEpic");

// Raidbots republishes Blizzard's item and talent data. Downloaded rather than checked out, so
// --items=/--talents= (or $RAIDBOTS_ITEMS/$RAIDBOTS_TALENTS) can point at saved copies offline.
const RB = "https://www.raidbots.com/static/data/live/";
const flag = (name, env) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : process.env[env] || null;
};
const ITEMS_FILE = flag("items", "RAIDBOTS_ITEMS");
const TALENTS_FILE = flag("talents", "RAIDBOTS_TALENTS");

// What to record as the upstream this was built from. Read from the checkout's own git history by
// default; --source= is for the case that history can't answer, which is building from files
// extracted out of a branch rather than from a working tree — the only way to read a pre-release
// branch without checking it out over somebody's work. Provenance is the whole point of `_meta`, so
// an extracted build has to be able to say which branch it came from instead of "unknown".
const SOURCE = flag("source", "QE_SOURCE");

/**
 * Import a source string as an ES module (used to evaluate QE's database files).
 *
 * Types are erased first, because QE writes these as TypeScript and a data: URL has no loader that
 * would strip them. Erasure only — no enums, namespaces or parameter properties survive it, and QE's
 * databases are plain annotated object literals, so anything that trips this is a shape change
 * upstream worth failing loudly on rather than working around.
 */
function importSource(src) {
  const js = stripTypeScriptTypes(src, { mode: "strip" });
  return import(
    `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`
  );
}

/**
 * Read the first of these paths that exists under the checkout. Upstream renames files between
 * patches — InstanceDB.js became InstanceDB.ts on the 12.1 branch — and a build that only knows the
 * new name can't read an older checkout, which is exactly what someone verifying a season rollover
 * has on disk.
 */
function read(...rels) {
  for (const rel of rels) {
    try {
      return readFileSync(join(QE, rel), "utf8");
    } catch {
      /* try the next spelling */
    }
  }
  console.error(
    `Can't read ${rels.join(" or ")} under ${QE}\nPoint at a QuestionablyEpic checkout with --qe=<path> or $QE_PATH.`,
  );
  process.exit(1);
}

/** Read a Raidbots JSON dump from disk if given a path, else download it. */
async function raidbots(name, file) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const res = await fetch(`${RB + name}.json`);
  if (!res.ok) {
    console.error(
      `Can't fetch ${RB}${name}.json (HTTP ${res.status}).\nSave a copy and pass --${name}=<path>.`,
    );
    process.exit(1);
  }
  return res.json();
}

/** Recursively sort object keys so two builds compare regardless of insertion order. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort(numericAware)) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

/** Sort numeric-looking keys by value, everything else lexically. */
function numericAware(a, b) {
  const na = Number(a),
    nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------------------------------------------------------- read upstream */

const constants = (await importSource(read("src/General/Engine/CONSTANTS.ts")))
  .CONSTANTS;

// InstanceDB imports CONSTANTS for a helper we don't use; stub it out so the module stands alone.
const instanceSrc = read(
  "src/Databases/InstanceDB.ts",
  "src/Databases/InstanceDB.js",
).replace(
  /^import\s+\{[^}]*\}\s+from\s+["'][^"']*CONSTANTS["'].*$/m,
  "const CONSTANTS = { currentDungeonIDs: [] };",
);
const instMod = await importSource(instanceSrc);
const { encounterDB, retailInstanceDB, instanceDB } = instMod;

const itemDB = JSON.parse(read("src/Databases/ItemDB.json"));

// QE's ItemDB is a healer database: every item in it is intellect, so it can't tell a healer
// trinket from a caster-DPS one in the same slot with the same stat. Blizzard can — items carry the
// list of specs they're allowed to drop for — and Raidbots republishes it as `specs`.
//
// Raidbots is not the whole story, though. It carries no `specs` for a tier set piece, and QE's own
// `classRestriction` does — so the two are merged below. Reading only Raidbots left every tier set
// in the raid unrestricted, and a Mistweaver's pools quietly included the Restoration Druid set,
// which shares leather and an agility-or-intellect stat line and is therefore invisible to the
// armor-and-stat fallback. 54 items in Season 2's content, one per boss that a spec can reach.
const rbItems = await raidbots("equippable-items", ITEMS_FILE);
const rbTalents = await raidbots("talents", TALENTS_FILE);

/* ------------------------------------------------------------------- transform */

// Raids: every instance in encounterDB that has a boss list. "-1" is the dungeon bucket, not a raid.
//
// `order` is upstream's `bossOrder` — the order you actually pull the raid in, which nothing else in
// the payload records. The boss map is keyed by journal encounter id and gets sorted by key on the
// way out, and those ids do not reliably ascend with pull order: Venomous Abyss ends on Coiled Altar
// (2883), an id that sorts sixth of eight. Anything asking "which are the last bosses" needs this
// list, so it is carried rather than re-derived. Filtered to ids the boss map names, which drops the
// sentinels bossOrder shares with the loot tables (999 catalyst, negative world drops).
const raids = {};
for (const [id, inst] of Object.entries(encounterDB)) {
  if (id === "-1" || !inst || !inst.bosses) continue;
  const order = (inst.bossOrder || [])
    .map(String)
    .filter((e) => e in inst.bosses);
  raids[id] = {
    name: inst.name || instanceDB[id] || `Instance ${id}`,
    bosses: { ...inst.bosses },
    ...(order.length ? { order } : {}),
  };
}

// Dungeons: the numeric keys of the retail "-1" bucket (bossOrder* are metadata, not dungeons).
const dungeons = {};
for (const [id, name] of Object.entries(retailInstanceDB["-1"].Retail)) {
  if (!/^-?\d+$/.test(id)) continue;
  dungeons[id] = name;
}

// Blizzard's primary-stat ids. 3/4/5 are fixed; 71-74 are the flexible ones an item resolves when
// it drops — 73 is "agility or intellect", which is what every leather and mail piece is, and
// reading it as a single stat would deny half a class its own armor.
const PRIMARY = {
  3: "a",
  4: "s",
  5: "i",
  71: "asi",
  72: "as",
  73: "ai",
  74: "si",
};

/** Secondary stats, for display only. 7 (stamina) is on everything and says nothing. */
const SECONDARY = { 32: "c", 36: "h", 40: "v", 49: "m" };

/** The set of primary stats an item can roll, as a code string ("ai"), or "" if it has none. */
function statSet(rb) {
  const seen = {};
  for (const s of rb?.stats || [])
    for (const ch of PRIMARY[s.id] || "") seen[ch] = 1;
  return ["a", "s", "i"].filter((ch) => seen[ch]).join("");
}

// Only items with exactly one possible primary stat vote — a flexible item says nothing about
// which of its stats a given spec takes.
const statVotes = {};
for (const it of rbItems) {
  if (!it.specs) continue;
  const set = statSet(it);
  if (set.length !== 1) continue;
  for (const id of it.specs) {
    if (!statVotes[id]) statVotes[id] = {};
    const v = statVotes[id];
    v[set] = (v[set] || 0) + 1;
  }
}

// Specs, from Blizzard's talent trees: id -> name + class. Everything the app knows about who can
// loot what keys off these ids, so they're derived rather than hand-listed — a new spec in a new
// expansion arrives on its own. Primary stat is inferred by majority vote over the items that name
// the spec explicitly: assuming it from the class would have called Midnight's Devourer demon
// hunter agility, and Blizzard made it intellect.
const NAMED_STAT = { a: "agi", s: "str", i: "int" };
const specs = {};
for (const t of rbTalents) {
  if (!t.specId || !t.specName) continue;
  const votes = statVotes[t.specId] || {};
  const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
  specs[t.specId] = {
    n: t.specName,
    c: t.className,
    st: NAMED_STAT[best] || "",
  };
}
const unstatted = Object.keys(specs).filter((id) => !specs[id].st);

// Items: everything QE knows with at least one source, annotated with Blizzard's eligibility facts
// where Raidbots has the item. `p` is the authoritative spec list when Blizzard restricts a drop;
// `u`/`iv` (armor subclass / inventory slot) and `st` (primary stat) carry the rest, since most
// items are unrestricted and eligibility falls back to "can my class wear this armor type, and is
// this my stat". See src/loot.js for the runtime rules.
const rbById = new Map(rbItems.map((x) => [x.id, x]));

// "Restoration Druid" -> spec id, for reading QE's `classRestriction`. Built off the same derived
// spec table the app keys everything else on, so a name upstream spells differently resolves to
// nothing rather than to the wrong spec — and `unnamedRestrictions` below reports it.
const specByName = new Map(
  Object.keys(specs).map((id) => [`${specs[id].n} ${specs[id].c}`, Number(id)]),
);
const unnamedRestrictions = new Set();

// QE writes a few restrictions as prose rather than as a spec. "DPS or Tank Spec" is its shorthand
// for "not a healer", on ~1900 legacy items and nothing current — a real statement, but not one in
// spec ids, and inventing the list it implies would be worse than falling back to armor and stat.
// Listed so the warning below stays about names that are genuinely new.
const NON_SPEC_RESTRICTIONS = new Set(["DPS or Tank Spec"]);

/**
 * Spec ids for QE's `classRestriction`, widened to the whole class, or null where it names nothing
 * we can resolve.
 *
 * Widened because QE is a healing tool and its restrictions are written from a healer's side: the
 * Monk tier set is recorded as "Mistweaver Monk" and the Druid set as "Restoration Druid", naming
 * the one spec QE has an opinion about rather than the set's real audience. Taken literally that
 * would hand a Windwalker a database in which the Monk tier set is somebody else's — precisely the
 * error this lookup exists to fix, pointed the other way.
 *
 * A tier set belongs to a class, so the class is the honest unit and it is enough for the job: it
 * keeps the Restoration Druid set out of a Mistweaver's pool, which is what leaked. Where the truth
 * really is one spec, this is too permissive — and that is the direction this file errs in on
 * purpose (see the header): a wrongly hidden item costs a roll, a wrongly shown one dilutes a number
 * the reader can see.
 */
function specsFromQE(qe) {
  const cr = qe?.classRestriction;
  if (!Array.isArray(cr) || !cr.length) return null;
  const ids = new Set();
  for (const name of cr) {
    const id = specByName.get(String(name).trim());
    if (!id) {
      if (!NON_SPEC_RESTRICTIONS.has(String(name).trim()))
        unnamedRestrictions.add(String(name));
      continue;
    }
    const cls = specs[id].c;
    for (const other of Object.keys(specs))
      if (specs[other].c === cls) ids.add(Number(other));
  }
  return ids.size ? [...ids].sort((a, b) => a - b) : null;
}

/**
 * Merge Blizzard's loot facts onto an entry. QE's own `stats` are deliberately not consulted: it
 * evaluates every item for a healer, so it reports intellect for gear that in fact rolls agility
 * *or* intellect, and believing it would hide a Windwalker's own bracers from them.
 */
function annotate(e, rb, qe) {
  // QE's own restriction stands in where Raidbots has none. Raidbots wins where both speak: it is
  // Blizzard's own list, and it is spec ids rather than names that have to be matched back.
  const fromQE = specsFromQE(qe);
  if (!rb) {
    if (fromQE) e.p = fromQE;
    return e;
  }
  e.c = rb.itemClass;
  e.u = rb.itemSubClass;
  e.iv = rb.inventoryType;
  if (rb.specs?.length) e.p = rb.specs.slice().sort((a, b) => a - b);
  else if (fromQE) e.p = fromQE;
  // What a tier token is a voucher for: the four class versions of one slot's tier piece. The token
  // is what the boss drops and what a roll can hand you, but every report scores the *piece*, so
  // without this link the pool holds the right item carrying none of its value. See `poolItem`.
  if (rb.contains?.length) e.ct = rb.contains.slice().sort((a, b) => a - b);
  const st = statSet(rb);
  if (st) e.st = st;
  if (rb.icon) e.ic = rb.icon;
  // Secondaries in the item's own order (biggest allocation first), for the hover card.
  const sec = (rb.stats || [])
    .map((x) => SECONDARY[x.id])
    .filter(Boolean)
    .join("");
  if (sec) e.sc = sec;
  return e;
}

// Items: everything QE knows with at least one source, each annotated with Blizzard's loot facts.
// Sources are [instId, encId] plus a 1 when very rare. instId -1 means "M+ dungeon, encId is the
// dungeon". Other negatives are QE sentinels for sources that can't be bonus-rolled at all (crafted,
// reputation, timewalking, PvP) — kept in the blob so the item is still named, but src/model.js
// drops them when ranking.
/**
 * Blizzard's sentinel for "made at the catalyst", which is how a tier set piece is really obtained.
 *
 * QE's ItemDB attributes tier pieces to the boss that drops the *token* for that slot, and the two
 * are not the same item: the Encounter Journal at Vashnikt lists the Venomcured Icon, and you trade
 * that for the Battle Gi of the Monkey King. Reading QE put both in the pool, so every tier boss was
 * one item too big for every class at once — 54 pieces across the raid's six sets.
 *
 * Raidbots has this right, so where the two disagree Raidbots wins. The item keeps its entry (names
 * are still wanted for a vault or a `/simc`), it just carries a source `resolve` already drops.
 */
const CATALYST = -100;
const catalystOnly = (rb) =>
  rb?.sources?.length
    ? rb.sources.every((x) => x.instanceId === CATALYST)
    : false;

const items = {};
let annotated = 0;
let decatalysed = 0;
for (const it of itemDB) {
  if (!it.sources?.length) continue;
  const rbSrc = rbById.get(it.id);
  if (catalystOnly(rbSrc)) {
    if (it.sources.some((x) => x.encounterId > 0)) decatalysed++;
    items[it.id] = annotate(
      { n: it.name, q: it.quality, s: [[CATALYST, CATALYST]] },
      rbSrc,
      it,
    );
    annotated++;
    continue;
  }
  const s = it.sources.map((x) =>
    x.veryRare
      ? [x.instanceId, x.encounterId, 1]
      : [x.instanceId, x.encounterId],
  );
  const rb = rbById.get(it.id);
  if (rb) annotated++;
  items[it.id] = annotate({ n: it.name, q: it.quality, s }, rb, it);
}

// QE's database stops at what a healer might equip, so on its own it can only ever describe part of
// a boss's loot table — and the pool size it implies is the denominator of every EV on the page.
// Fill in the rest from Raidbots: items dropping from an instance we know, that QE never listed.
let added = 0;
for (const rb of rbItems) {
  if (items[rb.id] || !rb.sources || !rb.sources.length) continue;
  const s = rb.sources
    .filter(
      (x) =>
        raids[x.instanceId] || (x.instanceId === -1 && dungeons[x.encounterId]),
    )
    .map((x) => [x.instanceId, x.encounterId]);
  if (!s.length) continue;
  added++;
  annotated++;
  items[rb.id] = annotate({ n: rb.name, q: rb.quality, s }, rb);
}

// Instances that items point at but encounterDB doesn't describe as encounters: world bosses,
// leveling drops, and old catch-up vendors. None are bonus-roll targets, so the app drops them —
// but it has to drop them *knowingly*. Recording them here is what keeps the runtime "unknown
// source" warning meaningful: it can then only fire for content genuinely newer than this build.
const ignoredInstances = [],
  unnamedDungeons = [],
  sentinelEncounters = new Set();
for (const it of Object.values(items)) {
  for (const [instId, encId] of it.s) {
    if (instId === -1) {
      if (!dungeons[encId] && !unnamedDungeons.includes(encId))
        unnamedDungeons.push(encId);
    } else if (instId > 0 && !raids[instId]) {
      if (!ignoredInstances.includes(instId)) ignoredInstances.push(instId);
    } else if (instId > 0 && (encId === 999 || encId < 0)) {
      // A real raid, but not an encounter: 999 is trash/catalyst, negatives are world drops filed
      // against the tier they match. src/model.js drops both; report them so that stays deliberate.
      sentinelEncounters.add(`${instId}/${encId}`);
    }
  }
}
ignoredInstances.sort((a, b) => a - b);

const data = canonical({
  raids,
  dungeons,
  currentRaids: constants.currentRaidIDs.map(String),
  currentDungeons: constants.currentDungeonIDs.map(String),
  ignoredInstances: ignoredInstances.map(String),
  seasonId: constants.seasonID,
  specs,
  items,
});

/* ---------------------------------------------------------------------- emit */

let qeCommit = SOURCE || "unknown";
if (!SOURCE) {
  try {
    qeCommit = execFileSync("git", ["-C", QE, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    /* not a git checkout — record it as unknown */
  }
}

// Emitted as plain JSON, fetched at runtime (src/data.js). JSON isn't just the honest shape for
// generated data — it is also the fast one: the browser reads it with its JSON parser instead of
// running a ~640KB object literal through the full JS parser (tokenize, AST, bytecode), which
// measured ~17.8ms vs ~9.6ms for this blob. A .js module can get the same win by wrapping the text
// in JSON.parse("..."), but then the data lives as an escaped string inside a string and nothing
// but this app can read it.
//
// JSON has no comments, so the provenance that used to sit in the header moves into `_meta`. It is
// excluded from the drift comparison below: qeCommit advances on every upstream commit, and a
// provenance-only change is not data drift.
//
// Indented, which is what the committed blob has always been — the emit was unindented and drifted
// from it, so every run rewrote all million characters onto one line and buried the season's actual
// changes in an unreadable diff. This file is regenerated at a season boundary and reviewed by
// eyeballing that diff, so a reviewable diff is worth the bytes. It costs ~280KB uncompressed and
// close to nothing over the wire: it is whitespace, and it is served gzipped.
const out = `${JSON.stringify(
  {
    _meta: {
      note: "Generated — do not hand-edit. Regenerate with `npm run data` (scripts/build-data.mjs). Shape: src/types.js QEData.",
      source: `QuestionablyEpic @ ${qeCommit}`,
      qeSeasonId: constants.seasonID,
    },
    ...data,
  },
  null,
  2,
)}\n`;

const counts =
  `${Object.keys(raids).length} instances · ${Object.keys(dungeons).length} dungeons · ` +
  `${Object.keys(items).length} items (${annotated} with loot rules, ${added} from Raidbots alone) · ` +
  `${Object.keys(specs).length} specs · ` +
  `season ${constants.seasonID}`;

if (unstatted.length) {
  // A spec no item names explicitly. Its gear can't be stat-filtered, so it would over-report what
  // that spec can loot. Never seen; worth knowing about if Blizzard's data changes shape.
  console.log(
    `WARNING: no primary stat inferable for spec ids: ${unstatted.join(", ")}`,
  );
}

if (decatalysed) {
  console.log(
    `Tier pieces re-filed from a boss to the catalyst (Raidbots over QE): ${decatalysed}`,
  );
}

if (unnamedRestrictions.size) {
  // QE spells a spec differently from Blizzard's talent data, so its restriction resolved to
  // nothing and those items fall back to armor-and-stat. Loud, because that is silently too
  // permissive rather than too strict — exactly the failure this lookup exists to stop.
  console.log(
    `WARNING: unresolvable classRestriction names: ${[...unnamedRestrictions].join(", ")}`,
  );
}

if (ignoredInstances.length) {
  const named = ignoredInstances
    .map((id) => id + (instanceDB[id] ? ` (${instanceDB[id]})` : ""))
    .join(", ");
  console.log(
    `Ignored instances — referenced by items, not described by encounterDB: ${named}`,
  );
}
if (sentinelEncounters.size) {
  const named = [...sentinelEncounters]
    .map((k) => `${k} (${raids[k.split("/")[0]].name})`)
    .join(", ");
  console.log(
    `Non-encounter raid sources — trash/catalyst and world drops, filtered at runtime: ${named}`,
  );
}
if (unnamedDungeons.length) {
  // Never seen upstream. If it happens, these dungeons would render as "Unknown dungeon N" and
  // trip the staleness warning, so they want a real name here rather than silent passage.
  console.log(
    `WARNING: M+ dungeon ids with no name in InstanceDB: ${unnamedDungeons.join(", ")}`,
  );
}
console.log(
  `Current raids: ${data.currentRaids.map((id) => `${id} ${raids[id] ? raids[id].name : "?"}`).join(", ")}`,
);
console.log(
  `Current dungeons: ${data.currentDungeons.map((id) => `${id} ${dungeons[id] || "?"}`).join(", ")}`,
);

if (CHECK) {
  // `_meta` is provenance, not data — dropped so a bare upstream commit bump doesn't read as drift.
  const prev = JSON.parse(readFileSync(OUT, "utf8"));
  delete prev._meta;
  const a = JSON.stringify(canonical(prev)),
    b = JSON.stringify(data);
  if (a === b) {
    console.log(`\n✓ data/qe-data.json is up to date — ${counts}`);
  } else {
    console.log(`\n✗ data/qe-data.json differs from a fresh build — ${counts}`);
    report(canonical(prev), data);
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, out);
  console.log(`\nWrote data/qe-data.json — ${counts}`);
}

/** Summarize what changed between the committed blob and a fresh build. */
function report(prev, next) {
  for (const key of ["raids", "dungeons", "items"]) {
    const pk = new Set(Object.keys(prev[key] || {})),
      nk = new Set(Object.keys(next[key] || {}));
    const added = [...nk].filter((k) => !pk.has(k)),
      removed = [...pk].filter((k) => !nk.has(k));
    const changed = [...nk].filter(
      (k) =>
        pk.has(k) &&
        JSON.stringify(prev[key][k]) !== JSON.stringify(next[key][k]),
    );
    if (!added.length && !removed.length && !changed.length) continue;
    const label = (k) =>
      key === "dungeons"
        ? next[key][k] || prev[key][k]
        : (next[key][k] || prev[key][k]).n ||
          (next[key][k] || prev[key][k]).name ||
          k;
    console.log(
      `  ${key}: +${added.length} -${removed.length} ~${changed.length}`,
    );
    for (const k of added.slice(0, 12)) console.log(`    + ${k} ${label(k)}`);
    if (added.length > 12) console.log(`    + …${added.length - 12} more`);
    for (const k of removed.slice(0, 12)) console.log(`    - ${k} ${label(k)}`);
    if (removed.length > 12) console.log(`    - …${removed.length - 12} more`);
    for (const k of changed.slice(0, 12)) console.log(`    ~ ${k} ${label(k)}`);
    if (changed.length > 12) console.log(`    ~ …${changed.length - 12} more`);
  }
  for (const key of [
    "currentRaids",
    "currentDungeons",
    "ignoredInstances",
    "seasonId",
  ]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      console.log(
        `  ${key}: ${JSON.stringify(prev[key])} -> ${JSON.stringify(next[key])}`,
      );
    }
  }
}
