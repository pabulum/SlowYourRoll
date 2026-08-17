// All DOM rendering: the encounter ranking, the "spend your roll on" verdict,
// this week's vault panel, and the per-encounter item pools.
//
// Markup is built with the `html` tag, which escapes every interpolated value — see src/html.js
// for why that is the default here. Item names come from QE Live's database and character names
// from a pasted report, so nothing on this page is text this app wrote.
//
// Elements are addressed through src/dom.js rather than by raw id, so a rename in index.html is a
// type error rather than a null.

import { QE_DATA, loadQEData } from "./data.js";
import {
  SEASON,
  SEASON_LABEL,
  seasonDrift,
  seasonName,
  REWARD_SEASON,
  REWARDS_LIVE,
  rewardOf,
  tokenVaultWindow,
  tokenWeekNow,
} from "./season.js";
import { state, active } from "./store.js";
import { $, setHTML, setText, setShown, setDisplayed } from "./dom.js";
import { html, join } from "./html.js";
import {
  buildGroups,
  resolve,
  diffLabel,
  diffKey,
  unitOf,
  rawUnitOf,
  hasPct,
  activeLootSpec,
  simcLootSpec,
  dv,
  vaultChoice,
  vaultStatus,
  priceWith,
  rollScored,
} from "./model.js";
import { specId, specInfo, classSpecs } from "./loot.js";
import { CLASS_COLOR } from "./classes.js";
import { iconHTML, nameHTML } from "./wowhead.js";

/**
 * The app's mark, drawn rather than set as 🎲 — an emoji is a different object on every platform and
 * brings a palette this page doesn't control. Kept in sync with the copy in index.html's masthead.
 */
const DIE = html`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect
    x="1.6"
    y="1.6"
    width="20.8"
    height="20.8"
    stroke="currentColor"
    stroke-width="1.7"
  />
  <circle cx="7.6" cy="7.6" r="1.85" fill="currentColor" />
  <circle cx="12" cy="12" r="1.85" fill="currentColor" />
  <circle cx="16.4" cy="16.4" r="1.85" fill="currentColor" />
</svg>`;

/** Fill in the season-dependent copy. Runs once at boot; nothing here changes at runtime. */
export function renderSeason() {
  setText("seasonLabel", SEASON_LABEL);
  setText("tokenNote", SEASON.tokenNote);
  // Only shown in a season that promotes rolls, where "the drop" and "what you'd receive" part ways.
  setShown("rewardNote", !!SEASON.rollReward);
  if (!SEASON.rollReward) return;
  setHTML(
    "rewardNote",
    html`A Season ${SEASON.number} bonus roll pays out
      <strong>as if the item came from your Great Vault</strong>, not off the
      boss: a Mythic boss hands back a fully upgraded item, Heroic and a +10 or
      higher key the first step of Myth. The item levels below are what a roll
      would actually give you — from the 12.1 PTR, so they may still move. What
      the <em>scores</em> are the value of depends on which tool ran the report,
      and each encounter says so where it matters.`,
  );
}

/* ---------- the reward pane ----------
   What a bonus roll actually hands you, per source. The game shows this nowhere: in game a boss
   drops what it drops, and the fact that a roll pays out on your *vault's* track instead is a rule
   you either read a guide for or install an addon to see. Every figure in it is already load-bearing
   somewhere in this app — the payout drives the dupe check, the item level on every row and the
   crest line — so the pane is the one place they're all legible at once rather than inferred from a
   chip on a card.

   It documents REWARD_SEASON, which is pinned rather than following the season the app is pricing;
   see src/season.js for why. So the heading always names its season, and the state line at the top
   says whether the page below is playing by these rules yet. */

/** The pane's rows, hardest first. Names are the pane's, not the report's difficulty vocabulary. */
const REWARD_ROWS = [
  { key: "mythic", name: "Mythic raid boss" },
  { key: "heroic", name: "Heroic raid boss" },
  { key: "normal", name: "Normal raid boss" },
  { key: "lfr", name: "Raid Finder boss" },
  { key: "mythic-plus", name: "M+ dungeon" },
];

/**
 * "Tuesday, August 18" — a reset, written the way the guides that date the season write it.
 *
 * Formatted in UTC rather than the reader's zone on purpose: these are the dates every week-by-week
 * guide is keyed to, and shifting one to "Wednesday, August 19" for a reader east of London would
 * quietly disagree with the guide they're holding.
 */
const RESET_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Which week it is, against the window in which the token costs a vault slot.
 *
 * The season's rules are written in week numbers, and until this line existed every one of them had
 * to be resolved against a calendar by hand. `long` is the drawer's version, a paragraph of its own;
 * the short one is a clause inside the vault banner's prose. Both come off one state so they can't
 * drift, and both render nothing where the season has no published dates.
 *
 * @param {import("./season.js").Season} s
 * @param {boolean} [long]
 */
function weekNowHTML(s, long) {
  const w = tokenWeekNow(s);
  if (!w) return "";
  const opens = RESET_FMT.format(w.opens),
    trades = RESET_FMT.format(w.trades);
  if (w.state === "before")
    return long
      ? html`<b>${seasonName(s)} opens ${opens}</b> — that's week 1. The first
          vault with a token in it is week ${tokenVaultWindow(s).from},
          ${trades}.`
      : html` The season opens ${opens}; the trade starts ${trades}.`;
  if (w.state === "early")
    return long
      ? html`<b>It's week ${w.week}.</b> There's no token in this vault — the
          first one is week ${tokenVaultWindow(s).from}, ${trades}.`
      : html` It's week ${w.week}: no token in this vault yet, so nothing is
        being given up for one.`;
  if (w.state === "free")
    return long
      ? html`<b>It's week ${w.week}.</b> The token is a free weekly reward now,
          so you take it and your vault item both.`
      : html` It's week ${w.week}, so the token is free and you get both.`;
  return long
    ? html`<b>It's week ${w.week}.</b> The token is a Great Vault slot this
        week: take it or take the item, not both.`
    : html` It's week ${w.week}, so the token <em>is</em> a vault slot — one
        choice, not two.`;
}

/** "≈80 Myth" — a crest yield, or an em dash where the payout banks none. */
function crestCell(r) {
  return r.crests ? html`≈${r.crests} ${r.crestKind || ""}` : "—";
}

/**
 * One source's row. `here` marks the difficulty the board is currently being ranked at, and
 * `keyLevel` does the same job for the M+ row, which has no raid difficulty to be marked by. They
 * are the pane's one live connection to the page behind it: the table is otherwise the same table
 * all week, and the row that answers "so what am I looking at" is the one you came for.
 *
 * The M+ row quotes whichever rung the report was run at, resolved the same way the cards resolve
 * it, so the pane and the ranking cannot disagree about what a dungeon roll pays.
 */
function rewardRowHTML(table, row, here, keyLevel) {
  const dungeon = row.key === "mythic-plus";
  const r = dungeon
    ? rewardOf(REWARD_SEASON, "dungeon", null, keyLevel)
    : table[row.key];
  if (!r) return "";
  const top = r.ladder && r.ladder[r.ladder.length - 1];
  const mine = dungeon ? keyLevel != null : row.key === here;
  return html`<tr class="${mine ? "here" : ""}">
    <th scope="row">
      ${row.name}${top && html`<span class="qual">${r.at || top.at}</span>`}${
        mine &&
        html`<span class="mine">your ${dungeon ? "key" : "raid diff"}</span>`
      }
    </th>
    <td>${r.label || "—"}</td>
    <td class="tnum">${r.ilvl == null ? "—" : r.ilvl}</td>
    <td>${crestCell(r)}</td>
  </tr>`;
}

/** The end-of-raid tier, as a sub-row of the Mythic one it's an exception to. */
function specialRowHTML(sp) {
  return html`<tr class="sub">
    <th scope="row">…its last ${sp.lastBosses} bosses</th>
    <td>${sp.badge}</td>
    <td class="tnum">${sp.ilvl == null ? "—" : sp.ilvl}</td>
    <td>—</td>
  </tr>`;
}

/**
 * The M+ ladder, and which rung the page is pricing.
 *
 * `keyLevel` is QE's key-slider index off the loaded report, or null where nothing recorded one —
 * a Droptimizer, a QE report from before 12.1, or no report at all. Those still get the top rung
 * quoted everywhere, so the foot has to keep saying by how much that can be out; a report that
 * *does* say gets the row marked instead, because the ceiling caveat is then simply not true of it.
 *
 * @param {import("./season.js").Reward} r
 * @param {number|null} [keyLevel]
 */
function ladderHTML(r, keyLevel) {
  const rungs = r.ladder || [];
  if (rungs.length < 2) return "";
  const over = rungs[rungs.length - 1].ilvl - rungs[0].ilvl;
  const mine =
    keyLevel == null
      ? null
      : rungs.find((k) => (k.keys || []).includes(keyLevel));
  return html`<section class="rwd-sec">
    <h3>M+, by key level</h3>
    <table class="rwd">
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Track</th>
          <th scope="col">ilvl</th>
        </tr>
      </thead>
      <tbody>
        ${rungs.map(
          (k) =>
            html`<tr class="${k === mine ? "here" : ""}">
              <th scope="row">
                ${k.at}${k === mine && html`<span class="mine">your key</span>`}
              </th>
              <td>${k.label || ""}</td>
              <td class="tnum">${k.ilvl}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <p class="rwd-foot">
      ${
        mine
          ? html`Your report was run at ${mine.at}, so every dungeon row on this
            page is priced at that rung rather than the ceiling.`
          : html`Every dungeon row on this page is priced at the top rung, since
            this report doesn't record the keys you run — so a lower key is
            overstated by up to ${over} item levels.`
      }
      Only the two ends are named tracks: Midnight's tracks overlap by two
      steps, so the rungs between can be read as a step of either track and this
      table won't guess which.
    </p>
  </section>`;
}

/**
 * Draw the pane. Called once at boot and again on every render, so the "you are here" marker
 * follows the difficulty toggle.
 *
 * @param {string|null} here  Canonical difficulty key the board is ranked at, or null when there's
 *   no report loaded to have one.
 * @param {number|null} [keyLevel]  QE key-slider index the loaded report was run at, where it
 *   records one. Absent or null leaves the M+ ladder quoting its ceiling, unmarked.
 */
export function renderRewards(here, keyLevel) {
  const s = REWARD_SEASON,
    table = s.rollReward;
  // Season first, in its own line: which season's rules these are is the first thing a reader has
  // to know, and it's the one thing the page around the pane can't be trusted to imply. Both the
  // ways in are labelled from the same place, so the season is never named twice by hand.
  setHTML(
    "rewardTitle",
    html`<span class="eyebrow">${seasonName(s)}</span>What a bonus roll pays`,
  );
  setText("rewardBtn", "S" + s.number + " rewards");
  $("rewardBtn").title = "What a bonus roll pays in " + seasonName(s);
  setHTML(
    "rewardLink",
    REWARDS_LIVE
      ? html`A roll pays out on your Great Vault's track rather than the drop's,
          which is where the item levels above come from.
          <button class="linky" data-act="rewards">
            See the reward table
          </button>`
      : html`In ${seasonName(s)} the drop's item level stops being the one you
          get: a roll pays out on your Great Vault's track instead.
          <button class="linky" data-act="rewards">
            See what it will pay
          </button>`,
  );
  if (!table) {
    setHTML(
      "rewardBody",
      html`<p class="rwd-lead">
        A ${seasonName(s)} bonus roll hands you the item exactly as the boss
        drops it — no promotion, no crests, nothing this pane can add to it.
      </p>`,
    );
    return;
  }
  const win = tokenVaultWindow(s);
  const mythCrest = (table.mythic && table.mythic.crests) || 0;
  const weekNow = weekNowHTML(s, true);

  setHTML(
    "rewardBody",
    html`<div class="rwd-state ${REWARDS_LIVE ? "live" : ""}">
        ${
          REWARDS_LIVE
            ? html`These are the rules the ranking below is already using.`
            : html`<b>Not live yet.</b> The page behind this is ranking
                ${seasonName(SEASON)}, where a roll simply hands you the drop.
                Nothing here is applied to those numbers.`
        }
      </div>

      <section class="rwd-sec">
        <h3>One token, either way</h3>
        <p>${s.tokenNote}</p>
        ${
          win &&
          html`<p>
            ${win.to ? html`Weeks ${win.from}–${win.to}` : html`From week ${win.from}`}
            the token <em>is</em> a Great Vault slot: you take the token or you
            take the item, not both.
            ${win.from > 1 && html`There is no token in the opening vault of the season at all.`}
            ${win.to && html`From week ${win.to + 1} it's a free weekly reward and you get both.`}
          </p>`
        }
        ${weekNow && html`<p class="rwd-now">${weekNow}</p>`}
      </section>

      <section class="rwd-sec">
        <h3>Where a roll pays out</h3>
        <p>
          Not at the item level the boss drops. A roll is paid as if the item
          had come out of your Great Vault, so LFR, Normal and Heroic each jump
          to the first step of the next track up, and a Mythic boss hands the
          thing over fully upgraded.
        </p>
        <table class="rwd">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Pays</th>
              <th scope="col">ilvl</th>
              <th scope="col">Crests</th>
            </tr>
          </thead>
          <tbody>
            ${REWARD_ROWS.map(
              (row) =>
                html`${rewardRowHTML(table, row, here, keyLevel)}${
                  row.key === "mythic" && s.special && specialRowHTML(s.special)
                }`,
            )}
          </tbody>
        </table>
        ${
          s.special &&
          html`<p class="rwd-foot">
            <b>${s.special.badge}.</b> ${s.special.note} It's the one place a
            roll promotes nothing — the drop is already there — so the token
            buys a second shot at it rather than an upgrade of it.
          </p>`
        }
        ${
          s.special &&
          s.special.heroicNote &&
          html`<p class="rwd-foot">${s.special.heroicNote}</p>`
        }
      </section>

      ${table["mythic-plus"] && ladderHTML(table["mythic-plus"], keyLevel)}

      <section class="rwd-sec">
        <h3>Crests</h3>
        <p>
          A Mythic roll banks
          <b>≈${mythCrest} ${table.mythic.crestKind || ""} crests</b>
          — the crests you'd otherwise have spent taking that item to
          ${table.mythic.label}. Every other payout lands on a track's first
          step, which is where a drop starts anyway, so it saves none.
        </p>
        <p>
          The yield is the same for every item in a pool. One you want arrives
          already upgraded; one you'd never wear still unlocks that slot, so the
          piece you actually equip upgrades free. So crests can't change
          <em>which</em> item you're rolling for — only whether a Mythic boss
          beats a dungeon for the same single token.
        </p>
      </section>

      <section class="rwd-sec">
        <h3>
          ${REWARDS_LIVE ? "What it changes on this page" : "What it will change here"}
        </h3>
        ${!REWARDS_LIVE && html`<p>Once the app moves to ${seasonName(s)}:</p>`}
        <ul class="rwd-list">
          <li>
            Item levels on every row are what a <em>roll</em> would hand you,
            not what the boss drops — that's what the Wowhead card is built from
            too.
          </li>
          <li>
            Anything you already hold at or above the payout auto-marks
            <b>Own</b>: the roll would only dupe it. A lower copy stays
            <b>Want</b>, because the roll still upgrades it.
          </li>
          <li>
            Scores are your report's, simmed at the level each boss
            <em>drops</em> at, so wherever a roll promotes they're a floor — and
            they understate that encounter against one paying a lower track.
          </li>
          <li>
            Crests are quoted on each encounter card and stay out of the EV.
          </li>
        </ul>
      </section>

      ${
        s.source &&
        html`<p class="rwd-src">
          Item levels read off
          <a href="${s.source.url}" target="_blank" rel="noopener"
            >${s.source.name}</a
          >. Pre-launch figures move; if they do, everything on this page moves
          with them.
        </p>`
      }`,
  );
}

/**
 * Warn when the encounter database has fallen behind what we're being asked to rank.
 * Two independent signals: sources in this report the database can't identify (a new raid, most
 * likely), and the database itself having moved to a season this build wasn't configured for.
 *
 * Both are the site's problem to fix, not the visitor's — the banner says what it means for the
 * numbers on screen and stops there. The maintainer's fix (`npm run data`, `src/season.js`) needs
 * a local checkout nobody browsing the site has, so it goes to the console instead.
 */
function renderDataNote(built) {
  const parts = [];
  if (built.unknown.length) {
    const n = built.unknown.length,
      many = n > 1;
    const list = join(built.unknown.slice(0, 4), ", ");
    const more = n > 4 ? " and " + (n - 4) + " more" : "";
    parts.push(
      html`<b
          >${n} encounter${many ? "s in" : " in"} this report
          ${many ? "aren't" : "isn't"} in the site's item data yet:</b
        >
        ${list}${more}. ${many ? "They're" : "It's"} still ranked off your own
        report's numbers, so where ${many ? "they land" : "it lands"} is real,
        but ${many ? "their names and loot tables" : "the name and loot table"}
        may be incomplete. Usually means new content just went live. Clears up
        once the site's data catches up.`,
    );
    console.warn(
      "[SlowYourRoll] Encounter database is missing: " +
        built.unknown.join(", ") +
        ". Maintainer fix: rerun `npm run data` against a current QuestionablyEpic checkout and commit data/qe-data.json.",
    );
  }
  if (seasonDrift(QE_DATA)) {
    parts.push(
      html`<b
          >The site's item data is from a newer season than the rest of the
          page.</b
        >
        Token costs and the season label above may be out of date, which can put
        raid and dungeon rows in the wrong order against each other. Each
        encounter's own loot table is still right.`,
    );
    console.warn(
      "[SlowYourRoll] Season drift: data/qe-data.json lists current raids " +
        (QE_DATA.currentRaids || []).join(", ") +
        ", but src/season.js is configured for " +
        (SEASON.qeRaids || []).join(", ") +
        ". Maintainer fix: bump ACTIVE in src/season.js.",
    );
  }
  setShown("dataNote", parts.length > 0);
  setHTML("dataNote", join(parts, html`<br /><br />`));
}

/**
 * The loot-spec picker. In game you choose which spec a boss loots you for, and that decides which
 * drops you're eligible for — so it decides the pool, and the ranking with it. Defaults to what a
 * linked /simc says you have set in game, then to the report's own spec; see `activeLootSpec`.
 * Only shown when the class has another spec to switch to.
 */
function renderLootSpec(b) {
  const own = specId(b.spec);
  const mine = own ? classSpecs(own) : [];
  const show = mine.length > 1;
  setDisplayed("lootSpecCtl", show);
  setShown("lootNote", false);
  if (!show) return;

  // Each option says where that spec came from, because the two sources routinely disagree and
  // the difference is the whole point of the control: the report says what was simmed, a linked
  // /simc says what the game will actually award.
  const cur = activeLootSpec(b);
  const fromSimc = simcLootSpec(b);
  // Both tags, when one spec is both — dropping either would leave the reader unable to tell
  // whether the two sources agree or whether one of them simply had nothing to say.
  const tag = (id) => {
    const src = [];
    if (id === own) src.push("report");
    if (id === fromSimc) src.push("in game");
    return src.length ? " (" + src.join(", ") + ")" : "";
  };
  setHTML(
    "lootSpecSel",
    mine.map(
      (id) =>
        html` <option value="${id}" ${id === cur ? "selected" : ""}>
          ${specInfo(id).n}${tag(id)}
        </option>`,
    ),
  );

  // Switching loot spec changes the pool honestly, but not the values: the report only ever simmed
  // one spec, so the other's gear sits at zero. Say so rather than let it read as "worth nothing".
  if (cur === own) return;
  const now = specInfo(cur).n;
  setShown("lootNote", true);
  setHTML(
    "lootNote",
    html`<b>Looting as ${now}, valued as ${specInfo(own).n}.</b> Pool sizes are
      right for this loot spec, but anything only ${now} can use scores 0,
      because the report never simmed it. Load a ${now} report to rank these
      properly.`,
  );
}

/* ---------- the report picker ----------
   One character usually has several reports loaded, one per spec — and boards are keyed by
   name · realm · spec, so within a character the spec is the *only* thing that tells two rows
   apart. So spec leads, in its class colour, and the character name only heads the group. */

/** A report's spec as "Frost Mage" — the bare spec name collides across classes. */
function specText(b) {
  const s = specInfo(specId(b.spec));
  return s ? s.n + " " + s.c : b.spec || "—";
}

/** The class-coloured dot for a report, or a neutral one when the spec didn't resolve. */
function swatch(b) {
  const s = specInfo(specId(b.spec));
  return html`<span
    class="cdot"
    style="--cls:${(s && CLASS_COLOR[s.c]) || "var(--faint)"}"
  ></span>`;
}

/**
 * "Jul 22" from whatever date string the report carried; the raw text if it won't parse.
 *
 * QE writes `dateCreated` as `"2026 - 7 - 29"` — spaced separators and a one-digit month, which
 * `Date` rejects outright, so every QE report was printing that string verbatim into the masthead.
 * The parts are unambiguous once matched, so they're read out and handed to `Date` as numbers
 * rather than left to a parser that has already refused them once.
 */
function shortDate(s) {
  if (!s) return "";
  const ymd = String(s).match(
    /^\s*(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/,
  );
  const d = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : new Date(s);
  return isNaN(d.getTime())
    ? String(s).replace(/\s+/g, " ").trim()
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Where a report came from and when — the line that says how stale its numbers are. */
function boardMeta(b) {
  const drop = b.source === "droptimizer";
  const d = shortDate(b.fetchedAt);
  return (
    (drop ? "Droptimizer" : "QE Live") +
    (d ? " · " + (drop ? "loaded " : "simmed ") + d : "")
  );
}

/** The realm, where there is one — a suffix on both the trigger and the menu rows. */
function realmTag(b) {
  return b.realm && html` <span class="rl">${b.realm}</span>`;
}

function renderBoardPicker(b) {
  setHTML(
    "boardBtn",
    html`${swatch(b)}<span class="nm">${b.player}</span
      ><span class="sp">${specText(b)}</span>${realmTag(b)}<span class="mk"
        >▾</span
      >`,
  );
  setText("specBadge", boardMeta(b));
  $("specBadge").title = b.fetchedAt || "";

  // Group by character, in the order they were first loaded.
  const groups = [];
  state.boards.forEach((x) => {
    const k = (x.player + "·" + x.realm).toLowerCase();
    let g = groups.find((y) => y.k === k);
    if (!g) {
      g = { k, boards: [] };
      groups.push(g);
    }
    g.boards.push(x);
  });

  setHTML(
    "boardMenu",
    groups.map((g) => {
      // A lone report has no sibling to be confused with, so it keeps the name on its own row;
      // only a character with several specs loaded needs the name lifted into a heading.
      const multi = g.boards.length > 1,
        g0 = g.boards[0];
      const head = multi
        ? html`<div class="pgroup">${g0.player}${realmTag(g0)}</div>`
        : "";
      return html`<div class="pgrp">
        ${head}${g.boards.map((x) => boardOptionHTML(x, x.id === b.id, multi))}
      </div>`;
    }),
  );

  // With a single report there's nothing to switch to — the trigger is just the nameplate.
  $("boardBtn").disabled = state.boards.length < 2;

  closeBoardMenu();
}

function boardOptionHTML(x, on, multi) {
  const lead = multi ? html`${specText(x)}` : html`${x.player}${realmTag(x)}`;
  const sub = (multi ? "" : specText(x) + " · ") + boardMeta(x);
  return html`<button
    class="popt ${on ? "on" : ""}"
    role="menuitemradio"
    aria-checked="${on}"
    data-board="${x.id}"
  >
    ${swatch(x)}<span class="ptext"
      ><span class="pl">${lead}</span><span class="pm">${sub}</span></span
    ><span class="pcheck">✓</span>
  </button>`;
}

/** Shut the picker. Every render passes through here — any state change closes it. */
export function closeBoardMenu() {
  setShown("boardMenu", false);
  $("boardBtn").setAttribute("aria-expanded", "false");
}

/** Re-render the whole app from current state. */
export function render() {
  const has = state.boards.length > 0;
  setShown("controls", has);
  setShown("listHead", has);
  if (!has) {
    renderRewards(null);
    setShown("dataNote", false);
    setHTML("verdict", "");
    setHTML(
      "sources",
      html`<div class="empty-state">
        <div class="big">${DIE}</div>
        <div>
          Paste a QE Live report (healers) or a Raidbots Droptimizer (everyone
          else) to see where your next roll pays best.
        </div>
        <div class="sub">
          Your report stays in this browser. Nothing is uploaded.
        </div>
      </div>`,
    );
    return;
  }
  // A saved report is waiting but the database hasn't landed yet (see src/data.js). Everything below
  // reads QE_DATA.items, so hold the frame and come back. Self-healing rather than caller-enforced:
  // render() is reached from a paste, an import, a share link and the boot path, and one of those
  // will eventually run before the fetch resolves.
  if (!QE_DATA) {
    renderRewards(null);
    setShown("dataNote", false);
    setHTML("verdict", "");
    setHTML(
      "sources",
      html`<div class="empty-state">
        <div class="big">${DIE}</div>
        <div>Loading the encounter database…</div>
      </div>`,
    );
    loadQEData().then(render, () => {
      setHTML(
        "sources",
        html`<div class="empty-state">
          <div class="big">⚠️</div>
          <div>
            Couldn't load the encounter database
            (<code>data/qe-data.json</code>).
          </div>
        </div>`,
      );
    });
    return;
  }
  const b = active();

  renderBoardPicker(b);
  $("showAll").checked = !!state.showAll;

  const built = buildGroups(b);

  // What the numbers on this page are: HPS off a healing report, DPS off a damage sim, either of
  // them optionally as a percentage of the character's own throughput. Raw is the default and the
  // left-hand button. Where no baseline can be established the control still renders, as a readout
  // — the unit has to be on screen whether or not there's a second one to switch to.
  setHTML(
    "metricSeg",
    hasPct(b)
      ? html`<button
            data-metric="raw"
            class="${b.metric !== "pct" ? "on" : ""}"
          >
            ${rawUnitOf(b)}</button
          ><button data-metric="pct" class="${b.metric === "pct" ? "on" : ""}">
            %
          </button>`
      : html`<span class="fixed">${unitOf(b)}</span>`,
  );

  // Difficulty toggle (only when there's a choice to make)
  const hasDiffs = built.diffs.length > 1;
  setDisplayed("diffCtl", hasDiffs);
  setHTML(
    "diffSeg",
    built.diffs.map(
      (d) =>
        html`<button
          data-diff="${d}"
          class="${d === built.selDiff ? "on" : ""}"
        >
          ${diffLabel(b, d)}
        </button>`,
    ),
  );

  renderRewards(diffKey(b, built.selDiff), built.keyLevel);
  renderLootSpec(b);
  renderSimcNote(b);
  renderDataNote(built);
  renderVault(b, built);
  renderVerdict(built, b);

  if (!built.rows.length) {
    setHTML(
      "sources",
      html`<div class="empty-state">
        <div class="sub">
          Nothing rollable at this filter. Try “Show older content”.
        </div>
      </div>`,
    );
    return;
  }
  setHTML(
    "sources",
    built.rows.map((r, i) => cardHTML(b, r, i)),
  );
}

/**
 * The addon can only log rolls made after it learned how, and says nothing at all when it has none
 * — which is indistinguishable from "you haven't rolled yet" unless we say so.
 */
function renderSimcNote(b) {
  const simc = state.simc[b.key];
  const silent = !!simc && !(simc.rolledIds || []).length;
  setShown("simcNote", silent);
  if (!silent) return;
  setHTML(
    "simcNote",
    html`<b>/simc linked, but it logged no bonus rolls.</b> The addon only
      records rolls you make <b>after</b> updating to 12.1.0 (Jul 6, 2026),
      can’t backfill older ones, and leaves the line out entirely when it has
      none. Mark this season’s earlier rolls by tapping an item to
      <b>Rolled</b>. Future ones import on their own.`,
  );
}

/**
 * A vault that has expired, offered for removal rather than silently ranked.
 *
 * The options in it are gone from the game — a vault is replaced wholesale at the weekly reset — so
 * there is no trade left to price and no item left to take. What it isn't is *deleted*: the paste it
 * came from is the user's, and quietly dropping the panel would leave someone who pasted a `/simc`
 * an hour ago wondering where it went. Naming the date and offering the button says which of the two
 * happened.
 *
 * The rest of that same paste — owned gear, logged rolls, loot spec — is untouched and still in use.
 * Only the weekly half of it expired, so only the weekly half is disowned here.
 */
function staleVaultHTML(st, n) {
  const when = st.at ? RESET_FMT.format(st.at) : null;
  return html`<div class="vault stale">
    <h3>Last week’s vault</h3>
    <div class="vsub">
      ${
        when
          ? html`These ${n} options were read from a <code>/simc</code> paste on
              ${when}, before the reset on ${RESET_FMT.format(st.reset)}.`
          : html`These ${n} options came from a <code>/simc</code> paste with no
              date on it, so they predate this app recording one.`
      }
      A vault is replaced at every reset, so they aren’t offered any more and
      nothing on this page is being weighed against them. Paste a fresh
      <code>/simc</code> when your next vault opens, or clear these.
    </div>
    <button class="btn tiny" data-act="clearvault">Clear vault options</button>
    <div class="note">
      Only the vault expires. The gear you own, your logged rolls and your loot
      spec came from the same paste and are still in use.
    </div>
  </div>`;
}

function renderVault(b, built) {
  const simc = state.simc[b.key];
  if (!simc || !simc.vault || !simc.vault.length) {
    setHTML("vaultPanel", "");
    return;
  }
  const st = vaultStatus(b);
  if (st && st.stale) {
    setHTML("vaultPanel", staleVaultHTML(st, simc.vault.length));
    return;
  }
  const rowByItem = {};
  built.rows.forEach((r) =>
    r.items.forEach((it) => {
      rowByItem[it.id] = r;
    }),
  );
  const vc = vaultChoice(b),
    optByItem = {};
  (vc ? vc.options : []).forEach((o) => {
    optByItem[o.id] = o;
  });

  setHTML(
    "vaultPanel",
    html`<div class="vault">
      <h3>
        This week’s vault
        <button class="linky" data-act="clearvault">clear</button>
      </h3>
      <div class="vsub">
        Taking an item leaves it in your roll pool: worth 0 to you, still
        diluting your odds, and a dupe if you roll that source too. Mark what
        you’ll take to fold it into the ranking.
      </div>
      ${tradeHTML(b, vc)}
      <div class="vault-items">
        ${simc.vault.map((v) =>
          vaultOptionHTML(b, v, rowByItem[v.id], optByItem[v.id]),
        )}
      </div>
      <div class="note">
        A taken pick becomes <b>Own</b> below. If a boss’s only upgrade is also
        your vault pick, its EV collapses. Take it from the vault and roll
        somewhere else.
      </div>
    </div>`,
  );
}

/**
 * One vault choice, priced both ways. The two EVs are counterfactuals computed from the row as it
 * stands, independent of what the board currently has marked as taken — the point is to show the
 * consequence of the toggle before it's flipped, not after.
 */
function vaultOptionHTML(b, v, row, opt) {
  const meta = QE_DATA.items[v.id];
  const taken = b.vaultTake === v.id;
  // The report scored the item at one level; the vault is handing you its own copy, often a track
  // step or more apart. Said out loud only where it's load-bearing — the two levels differ and the
  // number being qualified isn't zero.
  const offBy =
    opt && opt.score > 0 && opt.scoredIlvl && opt.scoredIlvl !== v.ilvl
      ? opt.scoredIlvl
      : 0;
  let encTxt,
    couple,
    warn = false;
  if (row) {
    encTxt = row.g.name;
    const leave = priceWith(row, v.id, "want"),
      take = priceWith(row, v.id, "own");
    warn = leave.num > take.num;
    couple = html`Roll ${row.g.name}: <b>${dv(b, leave.ev)}</b> if you leave it
      · <b>${dv(b, take.ev)}</b> if you take it`;
  } else {
    const src = meta && resolve(meta.s[0][0], meta.s[0][1]);
    encTxt = (src && src.name) || "—";
    couple = "Not in a rollable pool right now";
  }
  return html`<div class="vopt ${taken ? "taken" : ""}">
    <div>
      <div class="vname">${(meta && meta.n) || v.name}</div>
      <div class="vmeta">
        <span>${encTxt}</span><span>·</span
        ><span>ilvl ${v.ilvl}</span
        >${offBy > 0 && html`<span>· scored at ilvl ${offBy}</span>`}${
          warn &&
          html`<span class="warn">· also in this roll pool, dupe risk</span>`
        }
      </div>
      <div class="couple">${couple}</div>
    </div>
    <button class="btn tiny ${taken ? "primary" : ""}" data-vault="${v.id}">
      ${taken ? "Taking ✓" : "Take this"}
    </button>
  </div>`;
}

/**
 * The one comparison the encounter ranking can't make: a guaranteed item against a gamble.
 *
 * Both numbers are already on screen elsewhere; what's missing is that they're alternatives. Where
 * the season pays the roll token out of a vault slot they're strictly exclusive, and the wording
 * says so — otherwise this is a sanity check on whether spending a token is worth it at all.
 *
 * The recommendation is deliberately narrow: it compares this week's expected score and nothing
 * else. A roll also banks crests and can unlock free upgrades in its slot, and a guaranteed item
 * can't miss — neither is priced here, so the margin is stated rather than rounded to a verdict.
 *
 * The one lasting effect that *is* named is the drag: taking the item leaves it in its pool for
 * good, where a roll would have removed one. That asymmetry outlives the week the trade is made in.
 */
function tradeHTML(b, vc) {
  if (!vc || !vc.top) return "";
  const unit = unitOf(b),
    keep = vc.keep,
    roll = vc.top;
  const keepTxt = keep.scored
    ? html`<b>${dv(b, keep.score)}</b> ${unit} guaranteed from ${keep.name}`
    : html`${keep.name}, which your report never scored`;
  const lead = SEASON.tokenFromVault
    ? vc.verdict === "roll"
      ? "Take the token"
      : "Take the item"
    : vc.verdict === "roll"
      ? "The roll is worth it"
      : "Your vault beats your best roll";
  return html`<div class="trade ${vc.verdict}">
    <div class="tlead">${lead}</div>
    <div class="tbody">
      <b>${dv(b, vc.perRoll)}</b> ${unit} on average from one roll on
      ${roll.g.name}, against ${keepTxt}.
      ${keep.scored && html` A gap of ${dv(b, Math.abs(vc.perRoll - keep.score))} ${unit}.`}
      ${
        keep.score > 0 &&
        keep.scoredIlvl > 0 &&
        keep.scoredIlvl !== keep.ilvl &&
        html` That score is the report’s, simmed at ilvl ${keep.scoredIlvl} —
        your vault offers ilvl ${keep.ilvl}.`
      }
      ${roll.cost !== 1 && html` That roll costs ${roll.cost} tokens.`}
      ${tokenWeeksHTML()}
    </div>
    ${vc.drag && dragHTML(b, vc.drag, keep, unit)}
  </div>`;
}

/**
 * The one-line version of the token window, for the trade banner. "" when there is no trade.
 *
 * Where the season is dated, this says which week it is instead of the range — the banner is a
 * decision being made right now, and "weeks 2–7" leaves the reader to work out whether that's them.
 * The range stays as the fallback for a season whose calendar isn't out yet.
 */
function tokenWeeksHTML() {
  const win = tokenVaultWindow(SEASON);
  if (!win) return "";
  const now = weekNowHTML(SEASON);
  if (now) return now;
  return html` ${win.to ? html`Weeks ${win.from}–${win.to}` : html`From week ${win.from}`}
    the token <em>is</em> a vault slot, so it’s one choice, not two.
    ${win.to && html`From week ${win.to + 1} the token is free and you get both.`}`;
}

function dragHTML(b, d, keep, unit) {
  return html`<div class="tdrag">
    It doesn’t end this week either. Taking ${keep.name} leaves it in
    ${d.name}’s pool for good, worth nothing to you and still counted, which
    costs ${d.isTop ? "the encounter above" : "that encounter"}
    <b>${dv(b, d.amount)}</b> ${unit} on every roll you make there from now on.
    A roll would have taken it <em>out</em>.
  </div>`;
}

function renderVerdict(built, b) {
  const best = built.rows.find((r) => r.ev > 0);
  if (!best) {
    $("verdict").className = "verdict empty";
    setHTML(
      "verdict",
      html`<div>
        <div class="label">Next roll</div>
        <div class="target">
          No upgrades left in any pool, so hold your token.
        </div>
      </div>`,
    );
    return;
  }
  const next = built.rows.find((r) => r.ev > 0 && r.g.key !== best.g.key);
  const top = best.items
    .filter((i) => i.state === "want" && i.score > 0)
    .slice(0, 2)
    .map((i) => html`${i.name}${i.vr ? " ✦" : ""} (${dv(b, i.score)})`);
  const dl = best.g.type === "raid" ? diffLabel(b, built.selDiff) : "M+";
  $("verdict").className = "verdict";
  setHTML(
    "verdict",
    html`<div>
        <div class="label">Spend your next roll on</div>
        <div class="target">
          ${best.g.name}<span
            class="type-tag ${best.g.type}"
            style="margin-left:9px;vertical-align:middle"
            >${best.g.type} · ${dl}</span
          >
        </div>
        <div class="why">
          ${
            top.length
              ? html`carried by ${join(top, ", ")}`
              : html`${dv(b, best.num)} ${unitOf(b)} in the pool`
          }
          · ${best.remaining} in pool ·
          ${next ? html`${dv(b, best.ev - next.ev)} ahead of ${next.g.name}` : "your only live source"}
        </div>
      </div>
      <div class="big">
        <div class="ev tnum">${dv(b, best.ev)}</div>
        <div class="ev-unit">${unitOf(b)} / token</div>
      </div>`,
  );
}

/** "3 upgrades" — the count that says whether a pool is worth opening. */
function upgradeCount(n) {
  return n ? " · " + n + " upgrade" + (n > 1 ? "s" : "") : "";
}

function cardHTML(b, r, i) {
  const g = r.g,
    depleted = r.remaining <= 0;
  const cls =
    "card" +
    (i === 0 && r.ev > 0 ? " rank-1" : "") +
    (b._open === g.key ? " open" : "") +
    (depleted ? " depleted" : "");
  const math =
    r.remaining > 0
      ? dv(b, r.num) +
        " / " +
        r.remaining +
        (r.cost !== 1 ? " / " + r.cost : "")
      : "pool empty";
  const sub =
    (g.type === "raid" ? g.instName : "M+ dungeon") + upgradeCount(r.nWant);
  // Where a roll pays out. Worth saying per encounter rather than once: this is the season where a
  // Mythic boss and a dungeon cost the same single token and pay five upgrade steps apart.
  // Both chips open the reward pane: they're the two claims on a card that come from the season's
  // rules rather than from the report, and "pays Myth 6/6" is only meaningful to someone who
  // already knows the tracks. Buttons, so they're reachable without a pointer.
  const pays =
    r.reward &&
    r.reward.label &&
    html`<button
      class="pays"
      data-act="rewards"
      title="Paid out as if the item came from your Great Vault — see the reward table"
    >
      pays ${r.reward.label}
    </button>`;
  const special =
    g.special &&
    SEASON.special &&
    html`<button
      class="special"
      data-act="rewards"
      title="${SEASON.special.note}"
    >
      ${SEASON.special.badge}
    </button>`;

  return html`<div class="${cls}" data-key="${g.key}">
    <div class="card-head" data-act="toggle">
      <div class="rank tnum">${r.ev > 0 ? i + 1 : "–"}</div>
      <div class="name-cell">
        <div class="name">
          <span class="txt">${g.name}</span
          ><span class="type-tag ${g.type}">${g.type}</span>${special}${pays}
        </div>
        <div class="meta">${r.remaining} in pool · ${sub}${crestMeta(r)}</div>
      </div>
      <div class="ev-cell">
        <div class="ev tnum">${dv(b, r.ev)}</div>
        <div class="math">${math}</div>
      </div>
      <div class="chev">▸</div>
    </div>
    <div class="card-body">
      <div class="cfg-row">
        <div class="field">
          <label>Token cost</label>
          <input
            class="num-in tnum"
            data-act="cost"
            type="number"
            min="1"
            value="${r.cost}"
          />
        </div>
        <span
          >Σ ${dv(b, r.num)} want · ${r.remaining} in
          pool${r.cost !== 1 ? " · ÷" + r.cost + " tokens" : ""}</span
        >
      </div>
      ${specialNote(r)} ${promoNote(b, r)} ${crestNote(b, r)} ${itemsHTML(b, r)}
    </div>
  </div>`;
}

/**
 * Say what the scores below are the value of, which is a different sentence per report format.
 *
 * A Droptimizer — and any QE report from before 12.1 — sims each drop at the item level it drops
 * at, so where the season promotes the reward every score in the pool is a floor. It biases
 * *between* encounters too: the same token buys a Mythic boss's fully-upgraded item or a dungeon's
 * first step, and nothing in the EV maths knows that. Correcting those scores would mean re-simming
 * at the promoted item level, which is the report's job, not ours; naming the bias is what we can
 * honestly do here.
 *
 * A 12.1 QE report *is* that re-sim, so the note has the opposite job — the numbers are the payout
 * already, taken to the top of its track, and the reader should know that's the assumption rather
 * than discover it by wondering why a Heroic boss scores like a Mythic one. See `rollScored`.
 *
 * "A floor" is a claim about two numbers, so it is checked rather than assumed. A Droptimizer run
 * with an upgrade level set — Raidbots will happily sim every Heroic drop at Hero 6/6 — sims *above*
 * what a Heroic roll pays, and telling that reader their scores run low would be the wrong warning
 * in the wrong direction. Where the levels straddle the payout, no direction is claimed at all.
 */
function promoNote(b, r) {
  if (!r.reward || !r.reward.label) return "";
  if (rollScored(b))
    return html`<div class="swap-note">
      A roll here pays out at <b>${r.reward.label}</b>, and the scores below are
      your report's value for exactly that — the payout, taken to the top of its
      track with crests spent. Not the drop, which is lower.
    </div>`;
  const simmed = r.items
    .filter((i) => i.score > 0 && i.scoreLvl)
    .map((i) => i.scoreLvl);
  const pays = r.reward.ilvl;
  const lead = html`A roll here pays out at <b>${r.reward.label}</b>`;
  if (!simmed.length || pays == null)
    return html`<div class="swap-note">
      ${lead}, which is not the item level your report simmed each drop at.
    </div>`;
  if (pays >= Math.max(...simmed))
    return html`<div class="swap-note">
      ${lead}, above the ilvl your report simmed each drop at. So the scores
      below are a floor, and they understate this encounter against one that
      pays a lower track.
    </div>`;
  if (pays < Math.min(...simmed))
    return html`<div class="swap-note">
      ${lead} — ilvl ${pays} — while your report simmed these at ilvl
      ${Math.min(...simmed)} and up. So the scores below run a little high for
      what a roll would actually hand you.
    </div>`;
  return html`<div class="swap-note">
    ${lead} — ilvl ${pays} — which some of the items below were simmed above and
    some below. The scores aren't the payout's either way.
  </div>`;
}

/**
 * Crest yield, in the card's one-line summary. Uniform per roll, so it needs no qualifier there.
 *
 * Guarded with an `if` rather than `c && html\`…\``: most payouts bank *zero* crests, and zero is a
 * number the tag would faithfully render as "0". The `&&` shorthand is only safe where the left
 * side is a boolean or an object.
 */
function crestMeta(r) {
  const c = r.reward && r.reward.crests;
  if (!c) return "";
  return html` · ≈${c} ${r.reward.crestKind || ""} crests per roll`;
}

/**
 * What a roll here is worth in crests, kept in crests.
 *
 * This is the half of a roll's value the score can't carry, and the reason it's quoted in its own
 * currency is that converting it would need a crests-to-score rate that depends on which item you'd
 * have spent them on — which is exactly the opportunity cost no report computes.
 *
 * The figure doesn't vary within a pool, and that is the useful part. An item handed over already
 * upgraded saves the crests you'd have spent getting it there; one you'd never wear still unlocks
 * that slot, so the item you *do* wear upgrades free. Filler and upgrade yield the same crests.
 * So it can never reorder items inside an encounter — only encounters against each other, which is
 * precisely where a season that charges one token for both a Mythic boss and a dungeon needs it.
 */
function crestNote(b, r) {
  const c = r.reward && r.reward.crests;
  if (!c) return "";
  return html`<div class="swap-note">
    <b>≈${c} ${r.reward.crestKind || ""} crests</b> per roll, whatever it hands
    you. An item you want arrives already upgraded; one you don’t still unlocks
    that slot, so the piece you actually wear upgrades free. Same for every item
    here, so it can’t change <em>which</em> item you want, only whether this
    encounter beats another. Not in the EV above: folding it in needs a
    crests-to-${unitOf(b)} rate that depends on what you’d have spent them on,
    which no report gives.
  </div>`;
}

/** The end-of-raid encounters worth banking a token for, called out where the ranking can't see it. */
function specialNote(r) {
  if (!r.g.special || !SEASON.special) return "";
  return html`<div class="swap-note special-note">
    <b>${SEASON.special.badge}.</b> ${SEASON.special.note} The EV above prices
    <em>this week</em> only. It can’t weigh a token banked for kill week against
    one spent now.
    ${
      SEASON.special.heroicNote &&
      html`<span class="special-alt">${SEASON.special.heroicNote}</span>`
    }
  </div>`;
}

/**
 * A pool in three tiers, all of them on screen: the upgrades you're rolling for, the filler that
 * has no value but still dilutes the odds, and what this loot spec can't be handed at all. Only the
 * last is inert — the filler is the half of the pool you most need to *correct*, since marking one
 * Rolled is what takes it out of the denominator.
 */
function itemsHTML(b, r) {
  const showBlocked = active()._showBlockedKey === r.g.key;
  const canGet = r.items.filter((i) => i.elig !== false),
    blocked = r.items.filter((i) => i.elig === false);
  const upgrades = canGet.filter((i) => i.score > 0),
    filler = canGet.filter((i) => i.score <= 0);
  const group = (label, n) =>
    html`<div class="item-group">${label} <span class="n">${n}</span></div>`;

  return html`<div class="items">
      ${upgrades.map((it) => itemRow(b, it))}
      ${
        filler.length > 0 &&
        html` ${group(upgrades.length ? "No upgrade, still dilutes the pool" : "Nothing here is an upgrade", filler.length)}
        ${filler.map((it) => itemRow(b, it))}`
      }
      ${
        /* The blocked tier is reference, not work: it's out of the pool and can't be changed from here,
          so it folds away. What it's *for* is the alt-spec lines below, which read from it. */
        blocked.length > 0 &&
        html` <div class="item-group tap" data-act="showblocked">
            ${showBlocked ? "Hide" : "Show"}
            ${
              /* Two different "no" here. Nearly always it's loot spec, which is what the alt-spec
                 lines below are about; occasionally it's an item that is nobody's loot, and calling
                 that a loot-spec problem would send the reader looking for a spec that fixes it. */
              blocked.every((i) => (i.specs || []).length === 0 && !i.swap)
                ? "what a roll can’t hand you"
                : "what this loot spec can’t get"
            }
            <span class="n">${blocked.length}</span>
          </div>
          ${showBlocked && blocked.map((it) => itemRow(b, it))}`
      }
    </div>
    ${altNotes(b, r)}`;
}

/**
 * What another loot spec would do to this pool. Only better-EV options appear, each named by what
 * it sheds and what it costs — the whole point of switching is usually the dodge, not the gain.
 */
function altNotes(b, r) {
  return r.alts.slice(0, 2).map((a) => {
    const delta = a.remaining - r.remaining;
    const parts = [
      html`<b>Loot as ${specInfo(a.spec).n}:</b> EV ${dv(b, a.ev)} vs
        ${dv(b, r.ev)} · ${a.remaining} in
        pool${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`,
    ];
    if (a.dodges.length) parts.push(html`Dodges ${listOf(a.dodges)}`);
    if (a.gains.length) parts.push(html`Adds ${listOf(a.gains)}`);
    if (a.loses.length) parts.push(html`<b>Gives up ${listOf(a.loses)}</b>`);
    return html`<div class="swap-note">${join(parts, " · ")}</div>`;
  });
}

/** "A, B and 3 more" — item names for a one-line summary. */
function listOf(names) {
  const head = join(names.slice(0, 2), ", ");
  return names.length > 2 ? html`${head} and ${names.length - 2} more` : head;
}

/**
 * The item level to show and to build the Wowhead card from: what a roll here would hand you, which
 * in a season that promotes rewards to a vault track is a step or five above what the boss drops.
 * Stats roll from item level, so the card is wrong on the drop's.
 */
function rollIlvlOf(it) {
  return it.rollIlvl || it.lvl || 0;
}

function ilvlCell(it) {
  const lvl = rollIlvlOf(it);
  if (!lvl) return "";
  if (it.lvl && lvl !== it.lvl) {
    return html`<span
      class="promoted"
      title="Drops at ilvl ${it.lvl}, a bonus roll pays out at ilvl ${lvl}"
      >${lvl}</span
    >`;
  }
  return String(lvl);
}

/** "have 678" on a copy you already hold, gold when rolling it again would only duplicate it. */
function haveBadge(it) {
  if (it.ownedIlvl == null) return "";
  const why = it.dupe
    ? "You already have this at ilvl " +
      it.ownedIlvl +
      ", so a roll here would just dupe it"
    : it.rollIlvl
      ? "You have this at ilvl " +
        it.ownedIlvl +
        "; a roll here pays out at ilvl " +
        it.rollIlvl +
        ", a real upgrade"
      : "You have this at ilvl " +
        it.ownedIlvl +
        ", but a roll here pays out on a higher track, so probably still an upgrade";
  return html`<span class="have ${it.dupe ? "dupe" : ""}" title="${why}"
    >have ${it.ownedIlvl}</span
  >`;
}

function itemRow(b, it) {
  const lvl = rollIlvlOf(it);
  if (it.elig === false) {
    return html`<div class="item blocked" data-id="${it.id}">
      <span
        class="state-btn blocked"
        title="Your loot spec can't be awarded this"
        >Can't</span
      >
      <div class="iname">
        ${iconHTML(it.id, lvl)}${nameHTML(it.id, it.name, it.q, lvl)}<span
          class="why"
          >${it.why || "not for this spec"}</span
        >
      </div>
      <div class="ilvl">${ilvlCell(it)}</div>
      <div class="iscore tnum">—</div>
    </div>`;
  }
  const st = it.state || "want";
  const label = st === "want" ? "Want" : st === "own" ? "Own" : "Rolled";
  return html`<div
    class="item st-${st}${it.score <= 0 ? " zero" : ""}"
    data-id="${it.id}"
  >
    <button
      class="state-btn ${st}"
      data-act="cycle"
      title="Want → Own → Rolled"
    >
      ${label}
    </button>
    <div class="iname">
      ${iconHTML(it.id, lvl)}${nameHTML(it.id, it.name, it.q, lvl)}${
        /* A tier token is not the thing you wear, and its own name says nothing about what it is
           worth. The score on this row is the piece's, so the row has to name the piece. */
        it.givesName &&
        html`<span
          class="gives"
          title="Trade the token for this — the score is its value"
          >→ ${it.givesName}</span
        >`
      }${
        it.vr && html`<span class="vr">very rare</span>`
      }${exclusive(it)}${haveBadge(it)}
    </div>
    <div class="ilvl">${ilvlCell(it)}</div>
    <div class="iscore tnum">${it.score > 0 ? "+" + dv(b, it.score) : "—"}</div>
  </div>`;
}

/**
 * Badge an item that not every spec of the class can be awarded. On something you want that's a
 * reason not to switch; on filler it's the thing another spec would dodge for you.
 */
function exclusive(it) {
  const specs = it.specs || [];
  if (!specs.length || specs.length >= classSpecs(specs[0]).length) return "";
  const names = specs.map((s) => specInfo(s).n).join(" / ");
  return html`<span class="only" title="Only ${names} can loot this"
    >${names} only</span
  >`;
}
