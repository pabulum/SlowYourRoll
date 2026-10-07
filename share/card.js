// The share Worker: what it does with a request, given the database (worker.js bundles that in).
//
// A share link lands here (SHARE_HOST in src/share.js), and every request gets the same page: a
// Discord component embed and Open Graph tags describing the board, drawn from the card the link
// carries, plus one line of script that sends a person's browser on to the app. Previewers don't run
// script, so they stay and read the tags. Telling the two apart by user agent instead is one more
// thing to get wrong: any fetcher missing from the list is redirected to the app's generic card.
//
// Nothing is fetched and the model never runs (src/share.js says why), so a request costs well under
// a millisecond of CPU, and a card still draws after its Raidbots report has expired.
//
// A long link is a few hundred characters of query string, so the app has the Worker shorten it
// first: a POST stores it under three words (words.js) in D1, and `/GreedyFelMurloc` then reads it
// back and serves the same page the long link would. The long link keeps working on its own, which
// is also what the Share button copies when the Worker can't be reached.

import { CLASS_COLOR } from "../src/classes.js";
import { SEASON, seasonWeek } from "../src/season.js";
import { detectSource, parseMarks, readCard, shareUrl } from "../src/share.js";
import { ADJECTIVES, CREATURES, ELEMENTS } from "./words.js";

/** Where a person following a share link ends up. */
export const APP = "https://pabulum.github.io/SlowYourRoll/";
const ICON_CDN = "https://wow.zamimg.com/images/wow/icons/large/";
/** Discord's ceiling on a component embed's JSON, escapes included. */
export const EMBED_BYTES = 3000;

/** A short link's path: three capitalised words. */
const SLUG = /^(?:[A-Z][a-z]+){3}$/;
/** The longest link worth shortening. A real one, marks and all, is a few hundred characters. */
const MAX_LINK = 4096;
/**
 * Any page may ask for a short link, since all that can be stored is a link the Worker could have
 * been handed anyway, read back through the same checks a visit gets (`mint`).
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/**
 * The few D1 calls this file makes, which is all a test has to stand in for.
 * @typedef {{ bind(...values: unknown[]): D1Statement }} D1Prepared
 * @typedef {{ first(): Promise<any> }} D1Statement
 * @typedef {{ prepare(sql: string): D1Prepared,
 *   batch(statements: D1Statement[]): Promise<{ results: any[] }[]> }} D1
 */

const DEFAULT_TITLE = "Slow Your Roll · Bonus Roll EV";
const DEFAULT_DESCRIPTION =
  "Which boss is your next bonus roll worth the most on? Ranks every boss and M+ dungeon by EV, straight from your own QE Live or Droptimizer report.";

/**
 * @param {Request} req
 * @param {import("../src/types.js").QEData} data
 * @param {{ DB: D1 }} env
 * @returns {Promise<Response>}
 */
export async function handle(req, data, env) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });
  if (req.method === "POST" && url.pathname === "/")
    return mint(req, url, env.DB);
  if (req.method !== "GET" && req.method !== "HEAD")
    return new Response("Method not allowed", { status: 405 });

  // A short link reads back the long link's query, and from there it's the same page.
  let params = url.searchParams;
  if (url.pathname !== "/") {
    const slug = url.pathname.slice(1);
    const query = SLUG.test(slug) ? await lookup(env.DB, slug) : null;
    if (query == null) return Response.redirect(APP, 302);
    params = new URLSearchParams(query);
  }
  const app = appUrl(params);
  const card = readCard(params);
  const report = detectSource(params.get("report") || "");
  const view = card && report ? viewOf(card, report, app, data) : null;
  return new Response(pageHTML(url.href, app, view), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The card is fixed when the link is made, so what a URL shows never changes.
      "cache-control": "public, max-age=86400",
    },
  });
}

/**
 * Store a long share link under three words and answer with the short link. The words come from the
 * link's own hash, so the same link always gets the same ones and a second click stores nothing
 * new; a name that already holds a different link moves on to the next pick.
 *
 * What's stored is the link as a visit would read it, written back out by `shareUrl`, so nothing
 * gets in that a long link couldn't have said: unknown parameters fall away, a malformed card is no
 * card, and a link with no report is refused outright.
 *
 * @param {Request} req
 * @param {URL} url
 * @param {D1} db
 */
async function mint(req, url, db) {
  const body = await req.text();
  if (body.length > MAX_LINK) return json({ error: "Too long" }, 413);
  let params;
  try {
    params = new URL(body, url).searchParams;
  } catch {
    return json({ error: "Not a link" }, 400);
  }
  const report = detectSource(params.get("report") || "");
  if (!report) return json({ error: "No report in that link" }, 400);
  const b = /** @type {any} */ ({
    reportId: report.id,
    overlay: parseMarks(params),
  });
  const query = shareUrl(b, "", readCard(params)).slice(1);
  for (let n = 0; n < 4; n++) {
    const slug = await slugOf(query, n);
    const [, found] = await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO links (slug, query, created) VALUES (?1, ?2, ?3)",
        )
        .bind(slug, query, Date.now()),
      db.prepare("SELECT query FROM links WHERE slug = ?1").bind(slug),
    ]);
    if (found.results[0]?.query === query)
      return json({ url: `${url.origin}/${slug}` });
  }
  return json({ error: "No free name" }, 503);
}

/**
 * The long link's query a short link stands for, or null if no link has those words.
 *
 * @param {D1} db
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
async function lookup(db, slug) {
  const row = await db
    .prepare("SELECT query FROM links WHERE slug = ?1")
    .bind(slug)
    .first();
  return row ? row.query : null;
}

/**
 * Three words for a link, picked by its hash. `n` picks again, for when the first name is taken.
 *
 * @param {string} query
 * @param {number} [n]
 */
export async function slugOf(query, n = 0) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${n}:${query}`),
  );
  const h = new Uint8Array(digest);
  /** @param {string[]} list @param {number} at */
  const pick = (list, at) => list[((h[at] << 8) | h[at + 1]) % list.length];
  return pick(ADJECTIVES, 0) + pick(ELEMENTS, 2) + pick(CREATURES, 4);
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

/**
 * The app's share link for the same board — the report and its marks, not the card, which the app
 * has no use for. A link with no report it recognises goes to the app's front page.
 *
 * @param {URLSearchParams} params
 */
export function appUrl(params) {
  const d = detectSource(params.get("report") || "");
  if (!d) return APP;
  const b = /** @type {any} */ ({
    reportId: d.id,
    overlay: parseMarks(params),
  });
  return shareUrl(b, APP);
}

/**
 * @typedef {Object} View
 * @property {string} title
 * @property {string} description  The board in a sentence, for previews that only take text.
 * @property {string} color        The class colour, as `#rrggbb`.
 * @property {string|null} embed   The component embed's JSON, ready to drop into the page; null if
 *   even one row wouldn't fit Discord's ceiling.
 *
 * @typedef {Object} RowView
 * @property {string} name   Boss or dungeon.
 * @property {string} where  Raid and difficulty, or the key.
 * @property {number} ev
 * @property {number} want
 * @property {number} pool
 * @property {{ name: string, icon: string|undefined }|null} lead  The upgrade carrying the row.
 */

/**
 * The card with its names looked up and laid out. Null when the database knows none of its rows,
 * or not its spec: a link made against newer data than this Worker was deployed with.
 *
 * @param {import("../src/share.js").Card} card
 * @param {{ source: string, id: string }} report
 * @param {string} app
 * @param {import("../src/types.js").QEData} data
 * @returns {View|null}
 */
function viewOf(card, report, app, data) {
  const spec = data.specs?.[card.spec];
  const rows = card.rows.map((r) => rowOf(r, card, data)).filter(Boolean);
  if (!spec || !rows.length) return null;
  const title = `${card.who} · ${spec.n} ${spec.c}`;
  const unit = unitOf(card.unit);
  const color = CLASS_COLOR[spec.c] || "#d9a441";

  const week = seasonWeek(SEASON, new Date(card.at * 1000));
  const when = week
    ? `Season ${SEASON.number}, ${week.week ? `week ${week.week}` : "pre-season"} · `
    : "";
  const figures =
    report.source === "qe"
      ? card.payout
        ? "QE Live, Upgraded Bonus Rolls scores"
        : "QE Live, scores at drop level"
      : "Raidbots Droptimizer, scores at drop level";

  const head = text(
    `### ${title}\n-# Where the next bonus roll pays best, per token`,
  );
  const foot = text(`-# ${when}shared <t:${card.at}:R> · ${figures}`);
  const links = {
    type: 1,
    components: [
      { type: 2, style: 5, label: "Open board", url: app },
      report.source === "qe"
        ? {
            type: 2,
            style: 5,
            label: "QE report",
            url: `https://questionablyepic.com/live/upgradereport/${report.id}`,
          }
        : {
            type: 2,
            style: 5,
            label: "Droptimizer",
            url: `https://www.raidbots.com/simbot/report/${report.id}`,
          },
    ],
  };

  // Rows come off the bottom until the whole thing fits Discord's ceiling. Five rows with long item
  // names come to around 2.3 KB, so in practice nothing is dropped.
  let embed = null;
  for (let n = rows.length; n > 0 && !embed; n--) {
    const json = JSON.stringify({
      component: {
        type: 17,
        accent_color: Number.parseInt(color.slice(1), 16),
        components: [
          head,
          { type: 14 },
          ...rows.slice(0, n).map((r, i) => rowComponent(r, i, unit)),
          { type: 14 },
          foot,
          links,
        ],
      },
    }).replace(/</g, "\\u003c");
    if (new TextEncoder().encode(json).length <= EMBED_BYTES) embed = json;
  }

  const [top, ...rest] = rows;
  const then = rest.slice(0, 2).map((r) => r.name);
  return {
    title,
    description:
      `Next bonus roll: ${top.name} (${top.where}), ${evText(top.ev, unit)} per token, ` +
      `${upgrades(top)}.` +
      (then.length ? ` Then ${then.join(" and ")}.` : ""),
    color,
    embed,
  };
}

/**
 * @param {import("../src/share.js").CardRow} r
 * @param {import("../src/share.js").Card} card
 * @param {import("../src/types.js").QEData} data
 * @returns {RowView|null}
 */
function rowOf(r, card, data) {
  const raid = r.inst === -1 ? null : data.raids[r.inst];
  const name = raid
    ? raid.bosses[r.enc]
    : r.inst === -1
      ? data.dungeons[r.enc]
      : null;
  if (!name) return null;
  const diff = card.diff === "lfr" ? "LFR" : cap(card.diff || "");
  const it = r.item ? data.items[r.item] : null;
  return {
    name,
    where: raid
      ? [raid.name, diff].filter(Boolean).join(", ")
      : `Mythic+${card.key != null ? ` ${card.key}` : ""}`,
    ev: r.ev,
    want: r.want,
    pool: r.pool,
    lead: it ? { name: it.n, icon: it.ic } : null,
  };
}

/**
 * One ranked row: a section with the leading item's icon beside it, or plain text where there's no
 * icon to show, since a section has to have something beside it.
 *
 * @param {RowView} r
 * @param {number} i
 * @param {{ pct: boolean, name: string }} unit
 */
function rowComponent(r, i, unit) {
  // The rank's full stop is escaped: Discord reads "1. " as the start of a numbered list even inside
  // bold, and sets the rest of the line on a line of its own.
  const body = text(
    `**${i + 1}\\. ${md(r.name)}** · ${md(r.where)}\n` +
      `**${evText(r.ev, unit)}** per token · ${upgrades(r)}` +
      (r.lead ? `\n-# carried by ${md(r.lead.name)}` : ""),
  );
  if (!r.lead?.icon) return body;
  return {
    type: 9,
    components: [body],
    accessory: { type: 11, media: { url: `${ICON_CDN + r.lead.icon}.jpg` } },
  };
}

/** @param {string} content */
function text(content) {
  return { type: 10, content };
}

/** @param {import("../src/share.js").CardUnit} u */
function unitOf(u) {
  return { pct: u.startsWith("pct-"), name: u.slice(-3).toUpperCase() };
}

/**
 * @param {number} ev
 * @param {{ pct: boolean, name: string }} unit
 */
function evText(ev, unit) {
  const n = ev >= 100 ? Math.round(ev).toLocaleString("en-US") : String(ev);
  return `+${n}${unit.pct ? "%" : ""} ${unit.name}`;
}

/** @param {RowView} r */
function upgrades(r) {
  return `${r.want} upgrade${r.want === 1 ? "" : "s"} in a pool of ${r.pool}`;
}

/** @param {string} s */
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Escape what Discord would read as formatting in a name from the database. */
function md(s) {
  return s.replace(/[\\*_~|`]/g, "\\$&");
}

/** @param {string} s */
function esc(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

/**
 * The page every request gets. Open Graph for every previewer, and the component embed for Discord,
 * which reads it from the head of the page and prefers it to the Open Graph tags when both are
 * there. A link the Worker can't draw a card for gets the app's own preview text. A browser leaves
 * at the first script, and the link in the body is for one that doesn't run it.
 *
 * @param {string} href
 * @param {string} app
 * @param {View|null} view
 */
function pageHTML(href, app, view) {
  const title = view ? `${view.title} · Slow Your Roll` : DEFAULT_TITLE;
  const description = view ? view.description : DEFAULT_DESCRIPTION;
  const embed = view?.embed
    ? `\n<script id="discord:component-embed" type="application/json">${view.embed}</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>location.replace(${JSON.stringify(app).replace(/</g, "\\u003c")})</script>
<meta name="robots" content="noindex">
<title>${esc(title)}</title>${view ? `\n<meta name="theme-color" content="${view.color}">` : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Slow Your Roll">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(href)}">
<meta property="og:image" content="${APP}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">${embed}
</head>
<body><a href="${esc(app)}">Open the board in Slow Your Roll</a></body>
</html>
`;
}
