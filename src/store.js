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

/** Stable identity key for a character: name~realm~specFirstWord, normalized. */
export function keyOf(name, realm, spec) {
  return (
    String(name || "") +
    "~" +
    String(realm || "") +
    "~" +
    String(spec || "").split(/\s+/)[0]
  )
    .toLowerCase()
    .replace(/[^a-z0-9~]/g, "");
}

/** A unique board id. */
export function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `b${Date.now()}${Math.random().toString(36).slice(2)}`;
}
