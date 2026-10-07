import assert from "node:assert/strict";
import { test } from "node:test";
import { APP, appUrl, EMBED_BYTES, handle, slugOf } from "../share/card.js";
import { ADJECTIVES, CREATURES, ELEMENTS } from "../share/words.js";
import { QE_DATA } from "../src/data.js";
import { buildGroups, cardOf } from "../src/model.js";
import { CARD_ROWS, parseMarks, readCard, shareUrl } from "../src/share.js";
import { state } from "../src/store.js";

const RAID_ID = Number(QE_DATA.currentRaids[0]);
const RAID = QE_DATA.raids[String(RAID_ID)];
const ENC_ID = Number(Object.keys(RAID.bosses)[0]);
const DUNGEON_ID = Number(QE_DATA.currentDungeons[0]);
/** A real drop off that boss with an icon, so the card has something to look up. */
const ITEM_ID = Number(
  Object.keys(QE_DATA.items).find(
    (id) =>
      QE_DATA.items[id].ic &&
      QE_DATA.items[id].s.some((s) => s[0] === RAID_ID && s[1] === ENC_ID),
  ),
);
const AT = 1791000000;

/** @returns {import("../src/share.js").Card} */
function makeCard(over = {}) {
  return {
    who: "Handstamp",
    spec: "270",
    unit: "hps",
    diff: "heroic",
    key: 10,
    payout: true,
    at: AT,
    rows: [
      { inst: RAID_ID, enc: ENC_ID, ev: 4640, want: 2, pool: 3, item: ITEM_ID },
      { inst: -1, enc: DUNGEON_ID, ev: 21.3, want: 7, pool: 11, item: 0 },
    ],
    ...over,
  };
}

const board = /** @type {any} */ ({
  reportId: "cqovetmadchw",
  overlay: { [`${RAID_ID}:${ENC_ID}:1`]: "rolled" },
});

/** The link as the app would hand it out, pointed at a Worker. */
function linkTo(card) {
  return shareUrl(board, "https://share.example.workers.dev/", card);
}

/**
 * D1 as far as the Worker uses it: one table of slug → query, in a Map. `INSERT OR IGNORE` keeps
 * the first row for a slug, the same as SQLite.
 */
function fakeDB() {
  const rows = new Map();
  const exec = (sql, [slug, query]) => {
    if (sql.startsWith("INSERT")) {
      if (!rows.has(slug)) rows.set(slug, query);
      return [];
    }
    return rows.has(slug) ? [{ query: rows.get(slug) }] : [];
  };
  return {
    rows,
    prepare: (sql) => ({
      bind: (...args) => ({
        sql,
        args,
        first: async () => exec(sql, args)[0] ?? null,
      }),
    }),
    batch: async (stmts) =>
      stmts.map((st) => ({ results: exec(st.sql, st.args) })),
  };
}

/**
 * @param {string} url
 * @param {string} ua
 * @param {ReturnType<typeof fakeDB>} [db]
 */
function get(url, ua, db = fakeDB()) {
  return handle(
    new Request(url, { headers: { "user-agent": ua } }),
    QE_DATA,
    /** @type {any} */ ({ DB: db }),
  );
}

/** Ask the Worker to shorten a link, as the Share button does. */
function mint(long, db) {
  return handle(
    new Request("https://share.example.workers.dev/", {
      method: "POST",
      body: long,
    }),
    QE_DATA,
    /** @type {any} */ ({ DB: db }),
  );
}

const DISCORD =
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const BROWSER =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** The component embed a page carries, as Discord will parse it, plus its size as served. */
function embedOf(html) {
  const m = html.match(
    /<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  return {
    bytes: new TextEncoder().encode(m[1]).length,
    json: JSON.parse(m[1]),
  };
}

/** Every component in a tree, root included. */
function walk(c) {
  return [
    c,
    ...(c.components || []).flatMap(walk),
    ...(c.accessory ? walk(c.accessory) : []),
  ];
}

test("a card rides along in the share link and reads back as it was written", () => {
  const card = makeCard();
  const url = new URL(linkTo(card));
  assert.deepEqual(readCard(url.searchParams), card);
  // The marks are still there for the app, untouched by the card around them.
  assert.deepEqual(parseMarks(url.searchParams), board.overlay);
});

test("a share link without a card is the same link it always was", () => {
  assert.equal(
    shareUrl(board, "/", null),
    `/?report=cqovetmadchw&rolled=${RAID_ID}:${ENC_ID}:1`,
  );
});

test("readCard lets nothing free-form through", () => {
  const read = (over) => readCard(new URL(linkTo(makeCard(over))).searchParams);
  // The one string a card prints from the link has to look like a character name.
  assert.equal(read({ who: "[Free gold](https://evil.example)" }), null);
  assert.equal(read({ who: "Hand stamp" }), null);
  assert.equal(read({ who: "A" }), null);
  assert.equal(read({ who: "Hándstamp" })?.who, "Hándstamp");
  assert.equal(read({ unit: /** @type {any} */ ("gold") }), null);
  assert.equal(read({ spec: "Mistweaver" }), null);
  assert.equal(read({ at: 12 }), null);
  // Labels that don't parse are left off rather than sinking the card.
  const odd = read({ diff: "diff 7", key: /** @type {any} */ ("ten") });
  assert.equal(odd?.diff, null);
  assert.equal(odd?.key, null);
});

test("readCard drops malformed rows one at a time, and a card with none is no card", () => {
  const p = new URL(linkTo(makeCard())).searchParams;
  p.set(
    "top",
    [
      "1:2:30:1:4:5", // fine
      "1:2:30:5:4:5", // more upgrades than items in the pool
      "1:2:0:1:4:5", // worth nothing
      "1:2:abc:1:4:5",
      "1:2:30:1:4", // a field short
      "1:2:30:1:4:", // no item to name is fine
    ].join(","),
  );
  assert.deepEqual(
    readCard(p)?.rows.map((r) => r.item),
    [5, 0],
  );
  p.set(
    "top",
    Array(CARD_ROWS + 3)
      .fill("1:2:30:1:4:5")
      .join(","),
  );
  assert.equal(readCard(p)?.rows.length, CARD_ROWS);
  p.set("top", "nope");
  assert.equal(readCard(p), null);
});

/** A Droptimizer board with two upgrades on the same boss (as in model.test.js), as a Mistweaver. */
function makeBoard() {
  return /** @type {any} */ ({
    id: "t",
    key: "testkey",
    reportId: "abcdefghij0123456789XY",
    player: "Foo",
    realm: "",
    spec: "Mistweaver Monk",
    source: "droptimizer",
    metric: "raw",
    baseline: 1000,
    results: [900001, 900002].map((item, i) => ({
      item,
      inst: RAID_ID,
      enc: ENC_ID,
      diff: "mythic",
      level: 639,
      score: 10 * (i + 1),
    })),
    overlay: {},
    tokenOverride: {},
    vaultTake: null,
    raidDiff: null,
  });
}

test("cardOf takes the board's best rows, priced in the unit the page shows", () => {
  state.showAll = false;
  state.simc = {};
  const b = makeBoard();
  const built = buildGroups(b);
  const row = built.rows[0];
  const card = cardOf(b, built, new Date(AT * 1000));
  assert.equal(card.who, "Foo");
  assert.equal(card.spec, "270");
  assert.equal(card.unit, "dps");
  assert.equal(card.diff, "mythic");
  assert.equal(card.key, null, "no dungeon rows, so no key to label them with");
  assert.equal(card.payout, false, "a Droptimizer sims the drop");
  assert.equal(card.at, AT);
  assert.deepEqual(card.rows, [
    {
      inst: RAID_ID,
      enc: ENC_ID,
      ev: Number(row.ev.toPrecision(3)),
      want: 2,
      pool: row.remaining,
      item: 900002, // the bigger of the two upgrades
    },
  ]);

  b.metric = "pct";
  const pct = cardOf(b, buildGroups(b), new Date(AT * 1000));
  assert.equal(pct.unit, "pct-dps");
  assert.equal(pct.rows[0].ev, Number(((row.ev * 100) / 1000).toPrecision(3)));
});

test("cardOf has nothing to say about a board with no roll worth making", () => {
  const b = makeBoard();
  b.results = [];
  assert.equal(cardOf(b, buildGroups(b)), null);
});

test("every visitor gets the same page, and a browser's script sends it on to the app", async () => {
  const url = linkTo(makeCard());
  const [person, discord, unknown] = await Promise.all(
    [BROWSER, DISCORD, "SomeNewPreviewer/1.0"].map((ua) =>
      get(url, ua).then((r) => r.text()),
    ),
  );
  assert.equal(person, discord, "nothing depends on who's asking");
  assert.equal(unknown, discord);
  // The app gets the report and its marks, not the card.
  const app = `${APP}?report=cqovetmadchw&rolled=${RAID_ID}:${ENC_ID}:1`;
  assert.ok(
    person.includes(
      `<script>location.replace(${JSON.stringify(app)})</script>`,
    ),
  );
  assert.ok(
    person.indexOf("location.replace") <
      person.indexOf("discord:component-embed"),
    "a browser leaves before it reaches the rest",
  );
  assert.ok(person.includes('<meta name="robots" content="noindex">'));
});

test("anything that isn't a share link goes to the app's front page", async () => {
  assert.equal(appUrl(new URLSearchParams("report=<script>")), APP);
  const res = await get(
    "https://share.example.workers.dev/favicon.ico",
    BROWSER,
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), APP);
});

test("Discord gets a component embed of the board, inside its limits", async () => {
  const card = makeCard();
  const res = await get(linkTo(card), DISCORD);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  const html = await res.text();
  const embed = embedOf(html);
  assert.ok(embed, "the page carries a component embed");
  assert.ok(html.indexOf("discord:component-embed") < html.indexOf("</head>"));
  assert.ok(embed.bytes <= EMBED_BYTES, `${embed.bytes} bytes`);

  assert.ok(html.includes('<meta name="theme-color" content="#00ff98">'));
  const root = embed.json.component;
  assert.equal(root.type, 17);
  assert.equal(root.accent_color, 0x00ff98, "the Monk's class colour");
  const all = walk(root);
  assert.ok(all.length <= 40);
  assert.equal(all.filter((c) => c.type === 17).length, 1);
  for (const c of all.filter((c) => c.type === 2)) {
    assert.equal(c.style, 5, "link buttons only");
    assert.deepEqual(Object.keys(c).sort(), ["label", "style", "type", "url"]);
  }

  const texts = all
    .filter((c) => c.type === 10)
    .map((c) => c.content)
    .join("\n");
  assert.match(texts, /Handstamp · Mistweaver Monk/);
  const boss = RAID.bosses[String(ENC_ID)];
  assert.ok(texts.includes(`**1\\. ${boss}** · ${RAID.name}, Heroic`), texts);
  assert.ok(
    texts.includes("**+4,640 HPS** per token · 2 upgrades in a pool of 3"),
  );
  assert.ok(texts.includes(`carried by ${QE_DATA.items[ITEM_ID].n}`));
  assert.ok(
    texts.includes(`**2\\. ${QE_DATA.dungeons[DUNGEON_ID]}** · Mythic+ 10`),
  );
  assert.ok(texts.includes(`shared <t:${AT}:R>`));
  assert.ok(texts.includes("QE Live, Upgraded Bonus Rolls scores"));

  const thumbs = all.filter((c) => c.type === 11);
  assert.deepEqual(
    thumbs.map((t) => t.media.url),
    [
      `https://wow.zamimg.com/images/wow/icons/large/${QE_DATA.items[ITEM_ID].ic}.jpg`,
    ],
  );
  const urls = all.filter((c) => c.type === 2).map((c) => c.url);
  assert.deepEqual(urls, [
    `${APP}?report=cqovetmadchw&rolled=${RAID_ID}:${ENC_ID}:1`,
    "https://questionablyepic.com/live/upgradereport/cqovetmadchw",
  ]);
});

test("other previewers get the board as Open Graph text", async () => {
  const html = await (
    await get(linkTo(makeCard()), "Slackbot-LinkExpanding 1.0")
  ).text();
  assert.match(
    html,
    /<meta property="og:title" content="Handstamp · Mistweaver Monk · Slow Your Roll">/,
  );
  assert.ok(
    html.includes(
      `Next bonus roll: ${RAID.bosses[String(ENC_ID)]} (${RAID.name}, Heroic), +4,640 HPS per token`,
    ),
  );
});

test("a card naming nothing this Worker knows gets the app's own preview", async () => {
  const card = makeCard({
    rows: [{ inst: 999999, enc: 1, ev: 50, want: 1, pool: 4, item: 0 }],
  });
  const html = await (await get(linkTo(card), DISCORD)).text();
  assert.equal(embedOf(html), null);
  assert.match(html, /og:title" content="Slow Your Roll · Bonus Roll EV"/);
});

test("rows come off the bottom until the embed fits Discord's ceiling", async () => {
  const long = "Extraordinarily Long Item Name ".repeat(6);
  const data = {
    ...QE_DATA,
    raids: {
      1: {
        name: "A Raid With A Long Name",
        bosses: Object.fromEntries(
          Array.from({ length: 9 }, (_, i) => [i + 1, `Boss Number ${i + 1}`]),
        ),
      },
    },
    items: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        100 + i,
        {
          n: `${long}${i}`,
          q: 4,
          s: [],
          ic: `inv_some_rather_long_icon_name_${i}`,
        },
      ]),
    ),
  };
  const rows = Array.from({ length: CARD_ROWS }, (_, i) => ({
    inst: 1,
    enc: i + 1,
    ev: 1000 - i,
    want: 1,
    pool: 4,
    item: 100 + i,
  }));
  const url = linkTo(makeCard({ rows }));
  const html = await (
    await handle(
      new Request(url, { headers: { "user-agent": DISCORD } }),
      /** @type {any} */ (data),
      /** @type {any} */ ({ DB: fakeDB() }),
    )
  ).text();
  const embed = embedOf(html);
  assert.ok(embed.bytes <= EMBED_BYTES, `${embed.bytes} bytes`);
  const shown = walk(embed.json.component).filter((c) => c.type === 9).length;
  assert.ok(shown > 0 && shown < CARD_ROWS, `${shown} rows`);
});

const SLUG = /^(?:[A-Z][a-z]+){3}$/;

test("a long link is stored under three words, and those words read back the same card", async () => {
  const db = fakeDB();
  const long = linkTo(makeCard());
  const res = await mint(long, db);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const { url } = await res.json();
  const slug = new URL(url).pathname.slice(1);
  assert.match(slug, SLUG);
  assert.equal(url, `https://share.example.workers.dev/${slug}`);
  // What's kept is the long link's query, exactly as the app wrote it.
  assert.deepEqual([...db.rows], [[slug, new URL(long).search.slice(1)]]);

  const [byWords, byLink] = await Promise.all(
    [url, long].map((u) => get(u, DISCORD, db).then((r) => r.text())),
  );
  assert.deepEqual(embedOf(byWords).json, embedOf(byLink).json);
  assert.ok(byWords.includes(`<meta property="og:url" content="${url}">`));
});

test("the same link always gets the same words, and stores nothing new", async () => {
  const db = fakeDB();
  const long = linkTo(makeCard());
  const first = await (await mint(long, db)).json();
  const again = await (await mint(long, db)).json();
  assert.equal(again.url, first.url);
  assert.equal(db.rows.size, 1);
  assert.equal(
    new URL(first.url).pathname.slice(1),
    await slugOf(new URL(long).search.slice(1)),
  );
});

test("words already holding a different link move on to the next pick", async () => {
  const db = fakeDB();
  const query = new URL(linkTo(makeCard())).search.slice(1);
  const taken = await slugOf(query);
  db.rows.set(taken, "report=someoneElse");
  const { url } = await (await mint(`?${query}`, db)).json();
  assert.equal(new URL(url).pathname.slice(1), await slugOf(query, 1));
  assert.equal(db.rows.get(taken), "report=someoneElse", "untouched");
});

test("only what a long link can say gets stored", async () => {
  const db = fakeDB();
  const long = `${linkTo(makeCard())}&note=<script>alert(1)</script>&who2=Mallory`;
  await mint(long, db);
  const [stored] = [...db.rows.values()];
  assert.equal(stored, new URL(linkTo(makeCard())).search.slice(1));
  // No report, no link; and nothing long enough to be anything but abuse.
  assert.equal(
    (await mint("https://example.com/?who=Handstamp", db)).status,
    400,
  );
  assert.equal(
    (await mint(`?report=cqovetmadchw&x=${"a".repeat(5000)}`, db)).status,
    413,
  );
  assert.equal(db.rows.size, 1);
});

test("words no link has go to the app's front page", async () => {
  for (const path of ["NoSuchMurloc", "GreedyFelMurloc", "greedyfelmurloc"]) {
    const res = await get(`https://share.example.workers.dev/${path}`, DISCORD);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get("location"), APP);
  }
});

test("the app can ask for short links from its own origin", async () => {
  const res = await handle(
    new Request("https://share.example.workers.dev/", { method: "OPTIONS" }),
    QE_DATA,
    /** @type {any} */ ({ DB: fakeDB() }),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});

test("every word list makes names that split back into three words", () => {
  for (const list of [ADJECTIVES, ELEMENTS, CREATURES]) {
    assert.ok(list.length > 50);
    for (const w of list) assert.match(w, /^[A-Z][a-z]+$/);
    assert.equal(new Set(list).size, list.length, "no repeats");
  }
});
