// Building HTML strings, with escaping as the default rather than a discipline.
//
// Every name this app renders is third-party text — item names from QE Live's database, character
// and realm names from a pasted report. Concatenating those into `innerHTML` is safe exactly as
// long as nobody ever forgets an `esc()`, and "nobody ever forgets" is not a property a codebase
// can have. So the escaping moved into the interpolation itself: with the `html` tag, a value is
// escaped unless it is explicitly marked as markup.
//
//   html`<div class="${cls}">${item.name}</div>`   // cls and name both escaped
//   html`<ul>${rows.map(rowHTML)}</ul>`            // arrays join; nested html`` passes through
//   html`${cond && html`<b>only sometimes</b>`}`   // false / null / undefined render as nothing
//
// The escape hatch is `raw()`, which is the one thing to grep for when auditing.
//
// Interpolations are escaped for text content and for *double-quoted* attribute values, which is
// what `esc` covers. Single-quoted attributes are not safe — write `class="${x}"`, never
// `class='${x}'`.

/**
 * A string that is already markup and must not be escaped again. Never constructed from
 * user data directly — only from the `html` tag, or deliberately via `raw()`.
 */
export class Html {
  /** @param {string} s */
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/**
 * Mark a string as trusted markup. For static fragments the tag can't express — and for nothing
 * else. If the argument came from a report, a database or a URL, this is the wrong function.
 * @param {string} s
 */
export function raw(s) {
  return new Html(String(s));
}

/** Escape a value for interpolation into text or a double-quoted attribute. */
export function esc(t) {
  return String(t == null ? "" : t).replace(
    /[&<>"]/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[m],
  );
}

/**
 * One interpolated value, as markup. Exported because the same rules apply at the other boundary —
 * where markup leaves the module system for the DOM; see `setHTML` in src/dom.js.
 *
 * `null` / `undefined` / `false` render as nothing, so `cond && html\`…\`` reads as an optional
 * fragment. `true` renders as "true" — it only ever appears where a boolean is genuinely the
 * attribute value (`aria-checked="${on}"`), and blanking it there would emit invalid ARIA.
 * @param {unknown} v
 * @returns {string}
 */
export function part(v) {
  if (v == null || v === false) return "";
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

/**
 * Tagged template for HTML. Returns an `Html`, so nesting one inside another is safe and a bare
 * string never is.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {Html}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++)
    out += part(values[i]) + strings[i + 1];
  return new Html(out);
}

/**
 * Join fragments with a separator. Interpolating an array already joins it with nothing, which
 * covers most lists; this is for the ones that read as prose — " · " between clauses, a rule
 * between paragraphs. The separator is escaped like any other value unless it is itself markup.
 * @param {unknown[]} items
 * @param {unknown} sep
 * @returns {Html}
 */
export function join(items, sep) {
  return new Html(items.map(part).join(part(sep)));
}
