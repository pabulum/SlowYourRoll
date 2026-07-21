// Preloaded before the test files (via `node --import`). The app modules are written
// for the browser; these minimal stubs let the pure-logic modules import and run under
// Node without a DOM. Tests here only exercise pure functions — no real rendering.

/** @type {Map<string, string>} */
const store = new Map();
globalThis.localStorage = /** @type {any} */ ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

// A tolerant fake element so incidental save()/toast() calls don't throw.
const fakeEl = { textContent: "", innerHTML: "", classList: { add() {}, remove() {} } };
globalThis.document = /** @type {any} */ ({ getElementById: () => fakeEl });
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
