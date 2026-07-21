#!/usr/bin/env node
// Regenerates data/qe-data.js from a local QuestionablyEpic checkout.
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
const OUT = join(ROOT, "data/qe-data.js");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const qeArg = argv.find((a) => a.startsWith("--qe="));
const QE = qeArg ? qeArg.slice(5) : (process.env.QE_PATH || join(homedir(), "Projects/QuestionablyEpic"));

/** Import a source string as an ES module (used to evaluate QE's database files). */
function importSource(src) {
  return import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));
}

function read(rel) {
  try {
    return readFileSync(join(QE, rel), "utf8");
  } catch {
    console.error(`Can't read ${rel} under ${QE}\nPoint at a QuestionablyEpic checkout with --qe=<path> or $QE_PATH.`);
    process.exit(1);
  }
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
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------------------------------------------------------- read upstream */

// CONSTANTS.ts carries no type annotations, so it evaluates as plain JS.
const constants = (await importSource(read("src/General/Engine/CONSTANTS.ts"))).CONSTANTS;

// InstanceDB.js imports CONSTANTS for a helper we don't use; stub it out so the module stands alone.
const instanceSrc = read("src/Databases/InstanceDB.js")
  .replace(/^import\s+\{[^}]*\}\s+from\s+["'][^"']*CONSTANTS["'].*$/m, "const CONSTANTS = { currentDungeonIDs: [] };");
const instMod = await importSource(instanceSrc);
const { encounterDB, retailInstanceDB, instanceDB } = instMod;

const itemDB = JSON.parse(read("src/Databases/ItemDB.json"));

/* ------------------------------------------------------------------- transform */

// Raids: every instance in encounterDB that has a boss list. "-1" is the dungeon bucket, not a raid.
const raids = {};
for (const [id, inst] of Object.entries(encounterDB)) {
  if (id === "-1" || !inst || !inst.bosses) continue;
  raids[id] = { name: inst.name || instanceDB[id] || "Instance " + id, bosses: { ...inst.bosses } };
}

// Dungeons: the numeric keys of the retail "-1" bucket (bossOrder* are metadata, not dungeons).
const dungeons = {};
for (const [id, name] of Object.entries(retailInstanceDB["-1"].Retail)) {
  if (!/^-?\d+$/.test(id)) continue;
  dungeons[id] = name;
}

// Items: everything with at least one source. Sources are [instId, encId] plus a 1 when very rare.
// instId -1 means "M+ dungeon, encId is the dungeon". Other negatives are QE sentinels for sources
// that can't be bonus-rolled at all (crafted, reputation, timewalking, PvP) — kept in the blob so
// the item is still named, but src/model.js drops them when ranking.
const items = {};
for (const it of itemDB) {
  if (!it.sources || !it.sources.length) continue;
  const s = it.sources.map((x) => (x.veryRare ? [x.instanceId, x.encounterId, 1] : [x.instanceId, x.encounterId]));
  items[it.id] = { n: it.name, q: it.quality, s };
}

// Instances that items point at but encounterDB doesn't describe as encounters: world bosses,
// leveling drops, and old catch-up vendors. None are bonus-roll targets, so the app drops them —
// but it has to drop them *knowingly*. Recording them here is what keeps the runtime "unknown
// source" warning meaningful: it can then only fire for content genuinely newer than this build.
const ignoredInstances = [], unnamedDungeons = [];
for (const it of Object.values(items)) {
  for (const [instId, encId] of it.s) {
    if (instId === -1) {
      if (!dungeons[encId] && !unnamedDungeons.includes(encId)) unnamedDungeons.push(encId);
    } else if (instId > 0 && !raids[instId] && !ignoredInstances.includes(instId)) {
      ignoredInstances.push(instId);
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
  items,
});

/* ---------------------------------------------------------------------- emit */

let qeCommit = "unknown";
try {
  qeCommit = execFileSync("git", ["-C", QE, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch { /* not a git checkout — record it as unknown */ }

const out =
  "// @ts-nocheck  (generated data blob — not type-checked; typed via src/types.js QEData)\n" +
  "// Encounter + item database, generated from QuestionablyEpic + Raidbots source data.\n" +
  "// Regenerate rather than hand-edit: `npm run data` (see scripts/build-data.mjs).\n" +
  "// Shape documented in src/data.js.\n" +
  `// Source: QuestionablyEpic @ ${qeCommit} · QE seasonID ${constants.seasonID}\n` +
  "export const QE_DATA=" + JSON.stringify(data) + ";\n";

const counts =
  `${Object.keys(raids).length} instances · ${Object.keys(dungeons).length} dungeons · ` +
  `${Object.keys(items).length} items · season ${constants.seasonID}`;

if (ignoredInstances.length) {
  const named = ignoredInstances.map((id) => id + (instanceDB[id] ? ` (${instanceDB[id]})` : "")).join(", ");
  console.log(`Ignored instances — referenced by items, not described by encounterDB: ${named}`);
}
if (unnamedDungeons.length) {
  // Never seen upstream. If it happens, these dungeons would render as "Unknown dungeon N" and
  // trip the staleness warning, so they want a real name here rather than silent passage.
  console.log(`WARNING: M+ dungeon ids with no name in InstanceDB: ${unnamedDungeons.join(", ")}`);
}
console.log(`Current raids: ${data.currentRaids.map((id) => id + " " + (raids[id] ? raids[id].name : "?")).join(", ")}`);
console.log(`Current dungeons: ${data.currentDungeons.map((id) => id + " " + (dungeons[id] || "?")).join(", ")}`);

if (CHECK) {
  const prev = (await import(join(ROOT, "data/qe-data.js"))).QE_DATA;
  const a = JSON.stringify(canonical(prev)), b = JSON.stringify(data);
  if (a === b) {
    console.log(`\n✓ data/qe-data.js is up to date — ${counts}`);
  } else {
    console.log(`\n✗ data/qe-data.js differs from a fresh build — ${counts}`);
    report(canonical(prev), data);
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, out);
  console.log(`\nWrote data/qe-data.js — ${counts}`);
}

/** Summarize what changed between the committed blob and a fresh build. */
function report(prev, next) {
  for (const key of ["raids", "dungeons", "items"]) {
    const pk = new Set(Object.keys(prev[key] || {})), nk = new Set(Object.keys(next[key] || {}));
    const added = [...nk].filter((k) => !pk.has(k)), removed = [...pk].filter((k) => !nk.has(k));
    const changed = [...nk].filter((k) => pk.has(k) && JSON.stringify(prev[key][k]) !== JSON.stringify(next[key][k]));
    if (!added.length && !removed.length && !changed.length) continue;
    const label = (k) => (key === "dungeons" ? next[key][k] || prev[key][k] : (next[key][k] || prev[key][k]).n || (next[key][k] || prev[key][k]).name || k);
    console.log(`  ${key}: +${added.length} -${removed.length} ~${changed.length}`);
    for (const k of added.slice(0, 12)) console.log(`    + ${k} ${label(k)}`);
    if (added.length > 12) console.log(`    + …${added.length - 12} more`);
    for (const k of removed.slice(0, 12)) console.log(`    - ${k} ${label(k)}`);
    if (removed.length > 12) console.log(`    - …${removed.length - 12} more`);
    for (const k of changed.slice(0, 12)) console.log(`    ~ ${k} ${label(k)}`);
    if (changed.length > 12) console.log(`    ~ …${changed.length - 12} more`);
  }
  for (const key of ["currentRaids", "currentDungeons", "ignoredInstances", "seasonId"]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      console.log(`  ${key}: ${JSON.stringify(prev[key])} -> ${JSON.stringify(next[key])}`);
    }
  }
}
