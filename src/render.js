// All DOM rendering: the encounter ranking, the "spend your roll on" verdict,
// this week's vault panel, and the per-encounter item pools.

import { QE_DATA } from "./data.js";
import { SEASON, SEASON_LABEL, seasonDrift } from "./season.js";
import { state, active } from "./store.js";
import { $, esc } from "./util.js";
import { buildGroups, resolve, diffLabel, unitOf, dv } from "./model.js";

/** Fill in the season-dependent copy. Runs once at boot; nothing here changes at runtime. */
export function renderSeason() {
  $("seasonLabel").textContent = SEASON_LABEL;
  $("tokenNote").textContent = SEASON.tokenNote;
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
  const host = $("dataNote"), parts = [];
  if (built.unknown.length) {
    const n = built.unknown.length, many = n > 1;
    const list = built.unknown.slice(0, 4).map(esc).join(", ");
    const more = n > 4 ? " and " + (n - 4) + " more" : "";
    parts.push("<b>" + n + " encounter" + (many ? "s in" : " in") + " this report " + (many ? "aren't" : "isn't") +
      " in the site's item data yet</b> — " + list + more +
      ". " + (many ? "They're" : "It's") + " still ranked, using the numbers from your own report, so where " +
      (many ? "they land" : "it lands") + " in the list is real — but " + (many ? "their names and item lists" : "the name and item list") +
      " may be incomplete. This usually means new content just went live; it clears up once the site's data catches up.");
    console.warn("[SlowYourRoll] Encounter database is missing: " + built.unknown.join(", ") +
      ". Maintainer fix: rerun `npm run data` against a current QuestionablyEpic checkout and commit data/qe-data.js.");
  }
  if (seasonDrift(QE_DATA.seasonId)) {
    parts.push("<b>The site's item data is from a newer season than the rest of the page.</b> Bonus-roll token " +
      "costs and the season label above may be out of date, which can put raid and dungeon encounters in the " +
      "wrong order relative to each other. Each encounter's own item list is still accurate.");
    console.warn("[SlowYourRoll] Season drift: data/qe-data.js reports QE season id " + QE_DATA.seasonId +
      ", but src/season.js is configured for " + SEASON.qeSeasonId + ". Maintainer fix: bump ACTIVE in src/season.js.");
  }
  host.hidden = !parts.length;
  host.innerHTML = parts.map((p) => "◈ " + p).join("<br><br>");
}

/** Re-render the whole app from current state. */
export function render() {
  const has = state.boards.length > 0;
  $("controls").hidden = !has;
  $("listHead").hidden = !has;
  if (!has) {
    $("dataNote").hidden = true;
    $("verdict").innerHTML = "";
    $("sources").innerHTML = '<div class="empty-state"><div class="big">🎲</div><div>Paste a QE Live (healer) or Raidbots Droptimizer (DPS/tank) report above to see which encounter to roll on.</div><div class="sub">Your report stays in this browser — nothing is uploaded.</div></div>';
    return;
  }
  const b = active();

  // Board selector
  $("boardSel").innerHTML = state.boards.map((x) =>
    '<option value="' + x.id + '"' + (x.id === b.id ? " selected" : "") + ">" + esc(x.player) + (x.realm ? " · " + esc(x.realm) : "") + "</option>"
  ).join("");
  $("specBadge").textContent = b.spec + (b.fetchedAt ? "  ·  simmed " + b.fetchedAt.replace(/\s/g, "") : "");
  $("showAll").checked = !!state.showAll;

  const built = buildGroups(b);

  // Metric toggle (Droptimizer only: raw DPS vs % of baseline)
  const isDrop = b.source === "droptimizer";
  $("metricLabel").style.display = isDrop ? "" : "none";
  $("metricSeg").style.display = isDrop ? "" : "none";
  if (isDrop) $("metricSeg").innerHTML = '<button data-metric="raw" class="' + (b.metric !== "pct" ? "on" : "") + '">DPS</button><button data-metric="pct" class="' + (b.metric === "pct" ? "on" : "") + '">%</button>';

  // Difficulty toggle (only when there's a choice to make)
  const hasDiffs = built.diffs.length > 1;
  $("diffLabel").style.display = hasDiffs ? "" : "none";
  $("diffSeg").style.display = hasDiffs ? "" : "none";
  $("diffSeg").innerHTML = built.diffs.map((d) =>
    '<button data-diff="' + d + '" class="' + (d === built.selDiff ? "on" : "") + '">' + esc(diffLabel(b, d)) + "</button>"
  ).join("");

  const simc = state.simc[b.key], note = $("simcNote");
  if (simc && (!simc.rolledIds || !simc.rolledIds.length)) {
    note.hidden = false;
    note.innerHTML = '◈ <b>/simc linked, but it logged no bonus rolls.</b> The addon only records rolls you make <b>after</b> updating to 12.1.0 (Jul 6, 2026) — it can’t backfill earlier ones, and omits the line entirely when empty. Mark this season’s past rolls by tapping an item → <b>Rolled</b>; future rolls import automatically.';
  } else {
    note.hidden = true;
  }

  renderDataNote(built);
  renderVault(b, built);
  renderVerdict(built, b);

  const host = $("sources");
  if (!built.rows.length) {
    host.innerHTML = '<div class="empty-state"><div class="sub">No rollable encounters found for this filter. Try “Show older content”.</div></div>';
    return;
  }
  host.innerHTML = built.rows.map((r, i) => cardHTML(b, r, i)).join("");
}

function renderVault(b, built) {
  const host = $("vaultPanel"), simc = state.simc[b.key];
  if (!simc || !simc.vault || !simc.vault.length) { host.innerHTML = ""; return; }
  const rowByItem = {};
  built.rows.forEach((r) => { r.items.forEach((it) => { rowByItem[it.id] = r; }); });
  const html = simc.vault.map((v) => {
    const meta = QE_DATA.items[v.id], name = meta ? meta.n : v.name;
    const row = rowByItem[v.id], taken = b.vaultTake === v.id;
    let encTxt, couple, warn = false;
    if (row) {
      encTxt = row.g.name;
      const rem = row.remaining, cost = row.cost;
      // Counterfactuals, independent of the current toggle.
      const numLeave = row.items.reduce((t, it) => t + (it.id === v.id ? it.score : (it.state === "want" ? it.score : 0)), 0);
      const numTake = row.items.reduce((t, it) => t + (it.id === v.id ? 0 : (it.state === "want" ? it.score : 0)), 0);
      const evLeave = rem > 0 ? numLeave / rem / cost : 0, evTake = rem > 0 ? numTake / rem / cost : 0;
      warn = (numLeave - numTake) > 0;
      couple = 'Roll ' + esc(row.g.name) + ': <b>' + dv(b, evLeave) + '</b> if you leave it · <b>' + dv(b, evTake) + '</b> if you take it';
    } else {
      encTxt = meta ? (() => { const s = meta.s[0], info = resolve(s[0], s[1]); return info ? info.name : "—"; })() : "—";
      couple = "Not in a rollable pool right now";
    }
    return '<div class="vopt' + (taken ? ' taken' : '') + '">' +
      '<div><div class="vname">' + esc(name) + '</div>' +
      '<div class="vmeta"><span>' + esc(encTxt) + '</span><span>·</span><span>ilvl ' + v.ilvl + '</span>' + (warn ? '<span class="warn">· also in this roll pool — dupe risk</span>' : '') + '</div>' +
      '<div class="couple">' + couple + '</div></div>' +
      '<button class="btn tiny' + (taken ? ' primary' : '') + '" data-vault="' + v.id + '">' + (taken ? 'Taking ✓' : 'Take this') + '</button>' +
      '</div>';
  }).join("");
  host.innerHTML = '<div class="vault"><h3>◈ This week’s vault</h3>' +
    '<div class="vsub">Taking an item leaves it in your roll pool — worth 0 to you but still diluting the odds, and a possible dupe if you also roll that source. Mark what you’ll take to fold it into the ranking.</div>' +
    '<div class="vault-items">' + html + '</div>' +
    '<div class="note">A taken pick becomes <b>Own</b> below. If a boss’s only upgrade is also your vault pick, its roll EV collapses — take it from the vault and roll elsewhere.</div></div>';
}

function renderVerdict(built, b) {
  const host = $("verdict");
  const best = built.rows.filter((r) => r.ev > 0)[0];
  if (!best) {
    host.className = "verdict empty";
    host.innerHTML = '<div><div class="label">Next roll</div><div class="target">No upgrades in any pool right now — hold your token.</div></div>';
    return;
  }
  const next = built.rows.filter((r) => r.ev > 0 && r.g.key !== best.g.key)[0];
  const edge = next ? (" · " + dv(b, best.ev - next.ev) + " ahead of " + esc(next.g.name)) : " · your only live source";
  const top = best.items.filter((i) => i.state === "want" && i.score > 0).slice(0, 2)
    .map((i) => esc(i.name) + (i.vr ? " ✦" : "") + " (" + dv(b, i.score) + ")").join(", ");
  const dl = best.g.type === "raid" ? diffLabel(b, built.selDiff) : "M+";
  host.className = "verdict";
  host.innerHTML =
    '<div>' +
    '<div class="label">◈ Spend your next roll on</div>' +
    '<div class="target">' + esc(best.g.name) + '<span class="type-tag ' + best.g.type + '" style="margin-left:9px;vertical-align:middle">' + best.g.type + " · " + dl + '</span></div>' +
    '<div class="why">' + (top ? "carried by " + top : dv(b, best.num) + " of value") + " · " + best.remaining + " in pool" + edge + '</div>' +
    '</div>' +
    '<div class="big"><div class="ev tnum">' + dv(b, best.ev) + '</div><div class="ev-unit">' + esc(unitOf(b)) + ' / token</div></div>';
}

function cardHTML(b, r, i) {
  const g = r.g, depleted = r.remaining <= 0;
  const cls = "card" + (i === 0 && r.ev > 0 ? " rank-1" : "") + (b._open === g.key ? " open" : "") + (depleted ? " depleted" : "");
  const math = r.remaining > 0 ? (dv(b, r.num) + " / " + r.remaining + (r.cost !== 1 ? " / " + r.cost : "")) : "pool empty";
  const sub = g.type === "raid"
    ? (g.instName + (r.nWant ? " · " + r.nWant + " upgrade" + (r.nWant > 1 ? "s" : "") : ""))
    : ("M+ dungeon" + (r.nWant ? " · " + r.nWant + " upgrade" + (r.nWant > 1 ? "s" : "") : ""));
  return '' +
    '<div class="' + cls + '" data-key="' + g.key + '">' +
    '<div class="card-head" data-act="toggle">' +
    '<div class="rank tnum">' + (r.ev > 0 ? (i + 1) : "–") + '</div>' +
    '<div class="name-cell">' +
    '<div class="name"><span class="txt">' + esc(g.name) + '</span><span class="type-tag ' + g.type + '">' + g.type + '</span></div>' +
    '<div class="meta">' + r.remaining + ' in pool · ' + sub + '</div>' +
    '</div>' +
    '<div class="ev-cell"><div class="ev tnum">' + dv(b, r.ev) + '</div><div class="math">' + math + '</div></div>' +
    '<div class="chev">▸</div>' +
    '</div>' +
    '<div class="card-body">' +
    '<div class="cfg-row">' +
    '<div class="field"><label>Token cost</label><input class="num-in tnum" data-act="cost" type="number" min="1" value="' + r.cost + '"></div>' +
    '<span>Σ ' + dv(b, r.num) + ' want · ' + r.remaining + ' in pool' + (r.cost !== 1 ? ' · ÷' + r.cost + ' tokens' : '') + '</span>' +
    '</div>' +
    itemsHTML(b, r) +
    '</div>' +
    '</div>';
}

function itemsHTML(b, r) {
  const showZero = active()._showZeroKey === r.g.key;
  const shown = r.items, zeros = shown.filter((i) => i.score <= 0 && i.state === "want");
  const visible = shown.filter((i) => !(i.score <= 0 && i.state === "want" && !showZero));
  const html = visible.map((it) => itemRow(b, it)).join("");
  const toggle = (zeros.length && !showZero)
    ? '<div class="hidden-zero" data-act="showzero">+ ' + zeros.length + ' filler item' + (zeros.length > 1 ? "s" : "") + ' with no upgrade (still in pool) — show</div>'
    : '';
  return '<div class="items">' + html + '</div>' + toggle;
}

function itemRow(b, it) {
  const st = it.state || "want", lbl = st === "want" ? "Want" : (st === "own" ? "Own" : "Rolled");
  const zero = it.score <= 0 ? " zero" : "";
  const have = it.ownedIlvl != null
    ? '<span class="have' + (it.ownedIlvl >= (it.lvl || 0) ? " dupe" : "") + '" title="You already hold this item at ilvl ' + it.ownedIlvl + (it.ownedIlvl >= (it.lvl || 0) ? " — a duplicate" : " — a lower track; roll it if that's a real upgrade") + '">have ' + it.ownedIlvl + '</span>'
    : '';
  return '' +
    '<div class="item st-' + st + zero + '" data-id="' + it.id + '">' +
    '<button class="state-btn ' + st + '" data-act="cycle" title="Want → Own → Rolled">' + lbl + '</button>' +
    '<div class="iname"><span class="q' + (it.q || 3) + '">' + esc(it.name) + '</span>' + (it.vr ? '<span class="vr">very rare</span>' : '') + have + '</div>' +
    '<div class="ilvl">' + (it.lvl || "") + '</div>' +
    '<div class="iscore tnum">' + (it.score > 0 ? "+" + dv(b, it.score) : "—") + '</div>' +
    '</div>';
}
