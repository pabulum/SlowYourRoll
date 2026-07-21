// Small shared helpers: DOM lookup, HTML escaping, number formatting, and toasts.

/**
 * Shorthand for document.getElementById. Returns `any` so callers can reach
 * element-specific props (.value, .checked, .open) without per-call casts.
 * @param {string} id
 * @returns {any}
 */
export const $ = (id) => document.getElementById(id);

/** Escape a value for safe interpolation into innerHTML. */
export function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>"]/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[m]));
}

/** Format a number to at most 2 decimals with locale grouping. */
export function fmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Show a transient toast message at the bottom of the screen. */
let toastTimer;
export function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
