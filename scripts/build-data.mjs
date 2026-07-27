#!/usr/bin/env node
// Regenerates data/qe-data.json from a local QuestionablyEpic checkout.
//
//   npm run data                          # uses $QE_PATH, else ~/Projects/QuestionablyEpic
//   npm run data -- --qe=/path/to/QELive  # explicit checkout
//   npm run data:check                    # rebuild in memory and report drift, writing nothing
//
// Upstream sources, all inside the QE checkout:
//   src/General/Engine/CONSTANTS.ts  currentRaidIDs, currentDungeonIDs, seasonID
//   src/Databases/InstanceDB.js      encounterDB (raids + bosses), the "-1" dungeon map,
//                                    instanceDB (display names for instances with no boss list)
//   src/Databases/ItemDB.json        items: id, name, quality, sources[{instanceId, encounterId, veryRare}]
//
// Season rollover is entirely a CONSTANTS.ts change upstream: when QE flips currentRaidIDs /
// currentDungeonIDs to Season 2, rerun this and commit the result. Nothing here is hand-maintained.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

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
  const a = argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : process.env[env] || null;
};
const ITEMS_FILE = flag("items", "RAIDBOTS_ITEMS");
const TALENTS_FILE = flag("talents", "RAIDBOTS_TALENTS");

/** Import a source string as an ES module (used to evaluate QE's database files). */
function importSource(src) {
  return import(
    "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64")
  );
}

function read(rel) {
  try {
    return readFileSync(join(QE, rel), "utf8");
  } catch {
    console.error(
      `Can't read ${rel} under ${QE}\nPoint at a QuestionablyEpic checkout with --qe=<path> or $QE_PATH.`,
    );
    process.exit(1);
  }
}

/** Read a Raidbots JSON dump from disk if given a path, else download it. */
async function raidbots(name, file) {
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const res = await fetch(RB + name + ".json");
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

// CONSTANTS.ts carries no type annotations, so it evaluates as plain JS.
const constants = (await importSource(read("src/General/Engine/CONSTANTS.ts")))
  .CONSTANTS;

// InstanceDB.js imports CONSTANTS for a helper we don't use; stub it out so the module stands alone.
const instanceSrc = read("src/Databases/InstanceDB.js").replace(
  /^import\s+\{[^}]*\}\s+from\s+["'][^"']*CONSTANTS["'].*$/m,
  "const CONSTANTS = { currentDungeonIDs: [] };",
);
const instMod = await importSource(instanceSrc);
const { encounterDB, retailInstanceDB, instanceDB } = instMod;

const itemDB = JSON.parse(read("src/Databases/ItemDB.json"));

// QE's ItemDB is a healer database: every item in it is intellect, and it records no spec
// eligibility at all, so it can't tell a healer trinket from a caster-DPS one in the same slot with
// the same stat. Blizzard can — items carry the list of specs they're allowed to drop for — and
// Raidbots republishes it. We take nothing else from Raidbots; QE still supplies names, quality,
// sources and the "very rare" flag.
const rbItems = await raidbots("equippable-items", ITEMS_FILE);
const rbTalents = await raidbots("talents", TALENTS_FILE);

/* ------------------------------------------------------------------- transform */

// Raids: every instance in encounterDB that has a boss list. "-1" is the dungeon bucket, not a raid.
const raids = {};
for (const [id, inst] of Object.entries(encounterDB)) {
  if (id === "-1" || !inst || !inst.bosses) continue;
  raids[id] = {
    name: inst.name || instanceDB[id] || "Instance " + id,
    bosses: { ...inst.bosses },
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
  for (const s of (rb && rb.stats) || [])
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
    const v = statVotes[id] || (statVotes[id] = {});
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

/**
 * Merge Blizzard's loot facts onto an entry. QE's own `stats` are deliberately not consulted: it
 * evaluates every item for a healer, so it reports intellect for gear that in fact rolls agility
 * *or* intellect, and believing it would hide a Windwalker's own bracers from them.
 */
function annotate(e, rb) {
  if (!rb) return e;
  e.c = rb.itemClass;
  e.u = rb.itemSubClass;
  e.iv = rb.inventoryType;
  if (rb.specs && rb.specs.length) e.p = rb.specs.slice().sort((a, b) => a - b);
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
const items = {};
let annotated = 0;
for (const it of itemDB) {
  if (!it.sources || !it.sources.length) continue;
  const s = it.sources.map((x) =>
    x.veryRare
      ? [x.instanceId, x.encounterId, 1]
      : [x.instanceId, x.encounterId],
  );
  const rb = rbById.get(it.id);
  if (rb) annotated++;
  items[it.id] = annotate({ n: it.name, q: it.quality, s }, rb);
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
      sentinelEncounters.add(instId + "/" + encId);
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

let qeCommit = "unknown";
try {
  qeCommit = execFileSync("git", ["-C", QE, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  /* not a git checkout — record it as unknown */
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
const out =
  JSON.stringify({
    _meta: {
      note: "Generated — do not hand-edit. Regenerate with `npm run data` (scripts/build-data.mjs). Shape: src/types.js QEData.",
      source: `QuestionablyEpic @ ${qeCommit}`,
      qeSeasonId: constants.seasonID,
    },
    ...data,
  }) + "\n";

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
    .map((k) => k + ` (${raids[k.split("/")[0]].name})`)
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
  `Current raids: ${data.currentRaids.map((id) => id + " " + (raids[id] ? raids[id].name : "?")).join(", ")}`,
);
console.log(
  `Current dungeons: ${data.currentDungeons.map((id) => id + " " + (dungeons[id] || "?")).join(", ")}`,
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
