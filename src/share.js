// The share link's format, in both directions. Pure — no page, no state, no database — because two
// programs read it: the app, which writes a link and opens one, and the share Worker (share/card.js),
// which turns the same link into a link preview without running the app.
//
// A link is a report id plus the Rolled/Own marks, which is all the app needs to rebuild the board.
// A link that points at the Worker also carries the card: the board's best rows, as the sharer's
// page ranked them. That's a snapshot, not a recipe. Rebuilding a board means fetching the report
// and running the model, which costs about as much CPU as a free Worker gets (10 ms), and close to
// all of it on a cold start, while the page writing the link has just finished doing exactly that.

/**
 * Where share links point: the Worker (share/), which unfurls them as the board and sends people on
 * to the app. Null shares the page's own URL with no card, which is what a link was before the
 * Worker. Links already handed out keep pointing wherever this said at the time, so changing it
 * breaks them.
 * @type {string|null}
 */
export const SHARE_HOST =
  "https://slowyourroll-share.careful-agate-b2f.workers.dev/";

/** Detect which source a pasted link/code refers to. Returns { source, id } or null. */
export function detectSource(v) {
  v = (v || "").trim();
  if (!v) return null;
  if (/raidbots\.com/i.test(v)) {
    const m = v.match(/reports?\/([A-Za-z0-9]+)/);
    return m ? { source: "droptimizer", id: m[1] } : null;
  }
  const q = v.match(/upgradereport\/([A-Za-z0-9]+)/);
  if (q) return { source: "qe", id: q[1] };
  if (/^[A-Za-z0-9]{20,}$/.test(v)) return { source: "droptimizer", id: v }; // raidbots ids are long
  if (/^[A-Za-z0-9]{6,16}$/.test(v)) return { source: "qe", id: v };
  return null;
}

/** An overlay key, "instId:encId:itemId" — the only shape a share link's marks may take. */
const MARK_KEY = /^-?\d+:\d+:\d+$/;

/**
 * What a share card says: the board's best rolls, ranked and priced the way the sharer's page had
 * them when the link was made.
 *
 * @typedef {Object} Card
 * @property {string} who      Character name.
 * @property {string} spec     Spec id the pools were built for — the loot spec, which is not
 *   always the report's.
 * @property {CardUnit} unit   What each row's `ev` is in.
 * @property {string|null} diff  Difficulty the raid rows were priced at ("heroic"), if there are any.
 * @property {number|null} key   Key level the dungeon rows were priced at, where the report says.
 * @property {boolean} payout  The scores are the roll's payout taken to the top of its track
 *   (`rollScored`), not the drop.
 * @property {number} at       When the link was made, in Unix seconds.
 * @property {CardRow[]} rows  Best first.
 *
 * @typedef {"hps"|"dps"|"pct-hps"|"pct-dps"} CardUnit
 *
 * @typedef {Object} CardRow
 * @property {number} inst  Instance id, or -1 for an M+ dungeon — the first half of an overlay key.
 * @property {number} enc
 * @property {number} ev    Per token, in the card's unit.
 * @property {number} want  Upgrades still in the pool.
 * @property {number} pool  Items still in the pool.
 * @property {number} item  The pool's best upgrade, since a reader knows an item before a boss.
 *   0 when there's none to name.
 */

/** Most rows a card carries. */
export const CARD_ROWS = 5;
const UNITS = ["hps", "dps", "pct-hps", "pct-dps"];
const DIFFS = ["lfr", "normal", "heroic", "mythic"];
/** A row as a link writes it, `inst:enc:ev:want:pool:item`, with the item optional. */
const CARD_ROW =
  /^(-?\d{1,6}):(\d{1,6}):(\d{1,9}(?:\.\d{1,6})?):(\d{1,3}):(\d{1,3}):(\d{0,9})$/;

/**
 * The share link for a board: the report id, plus the items marked Rolled or Own. The report alone
 * reproduces the scores, but not the pool — an item already rolled is out of it, and without the
 * marks the recipient sees EVs for rolls the sharer can't make any more. Marks come from the
 * overlay, which already holds both what was clicked and what a /simc logged (`applySimc`).
 * Separators are left unencoded, so a link stays readable when pasted into chat.
 *
 * With a card, the link also carries it, for the Worker to draw (see the top of this file).
 *
 * @param {import("./types.js").Board} b
 * @param {string} base  The page's own URL, without query or hash — or the Worker's.
 * @param {Card|null} [card]
 */
export function shareUrl(b, base, card) {
  const byState = { rolled: [], own: [] };
  Object.keys(b.overlay || {}).forEach((k) => {
    const s = b.overlay[k];
    if (byState[s] && MARK_KEY.test(k)) byState[s].push(k);
  });
  let url = `${base}?report=${encodeURIComponent(b.reportId)}`;
  if (byState.rolled.length)
    url += `&rolled=${byState.rolled.sort().join(",")}`;
  if (byState.own.length) url += `&own=${byState.own.sort().join(",")}`;
  if (card?.rows.length) url += cardQuery(card);
  return url;
}

/** @param {Card} c */
function cardQuery(c) {
  let q = `&who=${encodeURIComponent(c.who)}&spec=${c.spec}&u=${c.unit}`;
  if (c.diff) q += `&d=${c.diff}`;
  if (c.key != null) q += `&k=${c.key}`;
  if (c.payout) q += "&pay=1";
  const rows = c.rows.map((r) =>
    [r.inst, r.enc, r.ev, r.want, r.pool, r.item || ""].join(":"),
  );
  return `${q}&at=${c.at}&top=${rows.join(",")}`;
}

/**
 * The marks a share link carries, as overlay entries. Anything that isn't a well-formed key is
 * dropped: the link is someone else's input, and the overlay is persisted.
 *
 * @param {URLSearchParams} params
 * @returns {Record<string, "own"|"rolled">}
 */
export function parseMarks(params) {
  /** @type {Record<string, "own"|"rolled">} */
  const out = {};
  for (const s of /** @type {const} */ (["own", "rolled"]))
    (params.get(s) || "")
      .split(",")
      .filter((k) => MARK_KEY.test(k))
      .forEach((k) => {
        out[k] = s;
      });
  return out;
}

/**
 * The card a share link carries, or null when it carries none worth drawing. The link is anyone's
 * input and the card ends up as text in someone else's chat, so nothing free-form gets through: the
 * name has to look like a character name, everything else is a number or one of a few fixed words,
 * and every other name a card prints is looked up from those numbers, never read off the link.
 * Malformed rows are dropped one by one, and a card left with none is no card. The difficulty and
 * key level only label rows, so one that doesn't parse is left off rather than sinking the card.
 *
 * @param {URLSearchParams} params
 * @returns {Card|null}
 */
export function readCard(params) {
  const who = params.get("who") || "";
  const spec = params.get("spec") || "";
  const unit = /** @type {CardUnit} */ (params.get("u") || "");
  const diff = params.get("d");
  const key = params.get("k");
  const at = Number(params.get("at"));
  if (!/^\p{L}{2,12}$/u.test(who)) return null;
  if (!/^\d{1,4}$/.test(spec) || !UNITS.includes(unit)) return null;
  if (!Number.isInteger(at) || at < 1.5e9 || at > 4e9) return null;
  const rows = (params.get("top") || "")
    .split(",")
    .flatMap((s) => {
      const m = CARD_ROW.exec(s);
      if (!m) return [];
      const [inst, enc, ev, want, pool, item] = m.slice(1).map(Number);
      return ev > 0 && want <= pool
        ? [{ inst, enc, ev, want, pool, item }]
        : [];
    })
    .slice(0, CARD_ROWS);
  if (!rows.length) return null;
  return {
    who,
    spec,
    unit,
    diff: DIFFS.includes(diff) ? diff : null,
    key: /^\d{1,2}$/.test(key || "") ? Number(key) : null,
    payout: params.get("pay") === "1",
    at,
    rows,
  };
}
