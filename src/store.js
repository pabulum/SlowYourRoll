// Persistent application state: the loaded reports ("boards"), the active board,
// linked /simc data, and view preferences. Persisted to localStorage; exportable
// as a JSON backup from the UI.

import { toast } from "./dom.js";

const KEY = "slowyourroll.v2";

function loadState() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p?.boards) {
      if (!p.simc) p.simc = {};
      rekey(p);
      if (!p.boards.some((b) => b.id === p.activeId))
        p.activeId = p.boards[0]?.id;
      return p;
    }
  } catch {
    /* fall through to a fresh state */
  }
  return { boards: [], activeId: null, showAll: false, simc: {} };
}

// `state` is a live binding — importers see reassignments from replaceState().
export let state = loadState();

/** Replace the whole state object (used when importing a backup file). */
export function replaceState(next) {
  if (!next.simc) next.simc = {};
  rekey(next);
  if (!next.boards.some((b) => b.id === next.activeId))
    next.activeId = next.boards[0]?.id;
  state = next;
}

let storageOK = true;
/** Persist the current state; warns once if browser storage is blocked. */
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    if (storageOK) {
      storageOK = false;
      toast("Browser storage is blocked. Use Export to keep a backup");
    }
  }
}

/** The currently selected board, or the first one as a fallback. */
export function active() {
  return state.boards.find((b) => b.id === state.activeId) || state.boards[0];
}

/**
 * One part of a key: lowercased, accents folded, everything but letters and digits dropped.
 * Letters in any script survive — the ASCII-only version this replaced reduced every Cyrillic name
 * on a realm to "", so two Russian characters of one spec shared a board and a /simc.
 */
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Identity key for a character, whatever spec: name~realm~region. What a /simc is filed under,
 * since everything in one — logged rolls, bags, the vault, the loot spec — belongs to the
 * character, and filing it per spec left a Holy board blind to the rolls a Discipline paste logged.
 * Region is part of it because a realm name is not unique across regions. A report that doesn't
 * say its region (a Droptimizer without its /simc input) keys as region "" and links to nothing
 * that does — the price of never linking a US character's /simc to an EU one.
 */
export function charKeyOf(name, realm, region) {
  return `${norm(name)}~${norm(realm)}~${norm(region)}`;
}

/**
 * Stable identity key for a board: the character's key plus the spec's first word. That word is
 * split on underscores too, because a /simc writes `beast_mastery` where a report says "Beast
 * Mastery".
 */
export function keyOf(name, realm, spec, region) {
  return `${charKeyOf(name, realm, region)}~${norm(String(spec || "").split(/[\s_]+/)[0])}`;
}

/**
 * The /simc linked to a board.
 * @param {import("./types.js").Board} b
 * @returns {import("./types.js").SimcData|undefined}
 */
export function simcOf(b) {
  return state.simc[charKeyOf(b.player, b.realm, b.region)];
}

/**
 * Bring a loaded state's keys up to the current `keyOf` and `charKeyOf`. A board whose key moved
 * would otherwise stop matching the next load of its own report and be duplicated. A /simc filed
 * under a board's key (how every paste was stored before `charKeyOf`) moves to that board's
 * character, the most recent paste winning where a character had one per spec.
 */
function rekey(p) {
  const moved = new Set(),
    chars = new Set();
  for (const b of p.boards) {
    const old = p.simc[b.key],
      ck = charKeyOf(b.player, b.realm, b.region);
    chars.add(ck);
    if (old && b.key !== ck) {
      const cur = p.simc[ck];
      if (!cur || (old.at || "") > (cur.at || "")) p.simc[ck] = old;
      moved.add(b.key);
    }
    b.key = keyOf(b.player, b.realm, b.spec, b.region);
  }
  for (const k of moved) if (!chars.has(k)) delete p.simc[k];
}

/** A unique board id. */
export function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `b${Date.now()}${Math.random().toString(36).slice(2)}`;
}
