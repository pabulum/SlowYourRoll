// All DOM rendering: the encounter ranking, the "spend your roll on" verdict,
// this week's vault panel, and the per-encounter item pools.

import { QE_DATA } from "./data.js";
import { SEASON, SEASON_LABEL, seasonDrift } from "./season.js";
import { state, active } from "./store.js";
import { $, esc } from "./util.js";
import { buildGroups, resolve, diffLabel, unitOf, dv, vaultChoice } from "./model.js";
import { specId, specInfo, classSpecs } from "./loot.js";
import { iconHTML, nameHTML } from "./wowhead.js";

/** Fill in the season-dependent copy. Runs once at boot; nothing here changes at runtime. */
export function renderSeason() {
  $("seasonLabel").textContent = SEASON_LABEL;
  $("tokenNote").textContent = SEASON.tokenNote;
  // Only shown in a season that promotes rolls, where "the drop" and "what you'd receive" part ways.
  const rn = $("rewardNote");
  if (SEASON.rollReward) {
    rn.hidden = false;
    rn.innerHTML = "A bonus roll in Season " + SEASON.number + " is paid out <strong>as if the item came from " +
      "your Great Vault</strong>, not from the boss — a Mythic boss hands back a fully upgraded item, " +
      "Heroic and M+ the first step of the Myth track. Item levels below are what the roll would " +
      "actually give you; the scores are still your report's, simmed at the item level each boss " +
      "<em>drops</em> at, so they run low wherever the roll promotes.";
  }
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

/**
 * The loot-spec picker. In game you choose which spec a boss loots you for, and that decides which
 * drops you're eligible for — so it decides the pool, and the ranking with it. Defaults to the
 * spec the report was run as; only shown when the class has another spec to switch to.
 */
function renderLootSpec(b) {
  const own = specId(b.spec), sel = $("lootSpecSel"), note = $("lootNote");
  const mine = own ? classSpecs(own) : [];
  const show = mine.length > 1;
  $("lootSpecLabel").style.display = show ? "" : "none";
  sel.style.display = show ? "" : "none";
  note.hidden = true;
  if (!show) return;
  const cur = b.lootSpec || own;
  sel.innerHTML = mine.map((id) =>
    '<option value="' + id + '"' + (id === cur ? " selected" : "") + ">" + esc(specInfo(id).n) +
    (id === own ? " (report)" : "") + "</option>"
  ).join("");

  // Switching loot spec changes the pool honestly, but not the values: the report only ever simmed
  // one spec, so the other's gear sits at zero. Say so rather than let it read as "worth nothing".
  if (cur !== own) {
    note.hidden = false;
    note.innerHTML = '◈ <b>Looting as ' + esc(specInfo(cur).n) + ', valued as ' + esc(specInfo(own).n) + '.</b> ' +
      'Pool sizes are right for this loot spec, but every item only ' + esc(specInfo(cur).n) +
      ' can use scores 0 — the report never simmed it. Load a ' + esc(specInfo(cur).n) +
      ' report to rank these for real.';
  }
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

  renderLootSpec(b);

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
    tradeHTML(b, vaultChoice(b)) +
    '<div class="vault-items">' + html + '</div>' +
    '<div class="note">A taken pick becomes <b>Own</b> below. If a boss’s only upgrade is also your vault pick, its roll EV collapses — take it from the vault and roll elsewhere.</div></div>';
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
 */
function tradeHTML(b, vc) {
  if (!vc || !vc.top) return "";
  const unit = unitOf(b), keep = vc.keep, roll = vc.top;
  const rollTxt = '<b>' + dv(b, vc.perRoll) + '</b> ' + esc(unit) + ' on average from one roll on ' + esc(roll.g.name);
  const keepTxt = keep.scored
    ? '<b>' + dv(b, keep.score) + '</b> ' + esc(unit) + ' guaranteed from ' + esc(keep.name)
    : esc(keep.name) + ', which your report never evaluated';
  const lead = SEASON.tokenFromVault
    ? (vc.verdict === "roll" ? "Take the token" : "Take the item")
    : (vc.verdict === "roll" ? "The roll is worth spending on" : "Your vault beats your best roll");
  const margin = keep.scored
    ? " The gap is " + dv(b, Math.abs(vc.perRoll - keep.score)) + " " + esc(unit) + "."
    : "";
  const price = roll.cost !== 1 ? " That roll costs " + roll.cost + " tokens." : "";
  const exclusive = SEASON.tokenFromVault
    ? " Weeks 1–7 the token <em>is</em> a vault slot, so this is one choice, not two — from week 8 the token is free and you get both."
    : "";
  return '<div class="trade ' + vc.verdict + '">' +
    '<div class="tlead">' + lead + '</div>' +
    '<div class="tbody">' + rollTxt + ', against ' + keepTxt + '.' + margin + price + exclusive + '</div>' +
    '</div>';
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
  // Where a roll pays out. Worth saying per encounter rather than once: this is the season where a
  // Mythic boss and a dungeon cost the same single token and pay five upgrade steps apart.
  const pays = r.reward && r.reward.label
    ? '<span class="pays" title="A bonus roll here is paid out as if the item came from your Great Vault">pays ' + esc(r.reward.label) + '</span>'
    : "";
  return '' +
    '<div class="' + cls + '" data-key="' + g.key + '">' +
    '<div class="card-head" data-act="toggle">' +
    '<div class="rank tnum">' + (r.ev > 0 ? (i + 1) : "–") + '</div>' +
    '<div class="name-cell">' +
    '<div class="name"><span class="txt">' + esc(g.name) + '</span><span class="type-tag ' + g.type + '">' + g.type + '</span>' + pays + '</div>' +
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
    promoNote(r) +
    itemsHTML(b, r) +
    '</div>' +
    '</div>';
}

/**
 * Say out loud that the scores below are not the scores of the item you'd receive.
 *
 * A report sims each drop at the item level it drops at, so where the season promotes the reward
 * every score in the pool is a floor. It biases *between* encounters too — the same token buys a
 * Mythic boss's fully-upgraded item or a dungeon's first step, and nothing in the EV maths knows
 * that. Correcting the scores would mean re-simming at the promoted item level, which is the
 * report's job, not ours; naming the bias is what we can honestly do here.
 */
function promoNote(r) {
  if (!r.reward || !r.reward.label) return "";
  return '<div class="swap-note">A roll here is paid out as <b>' + esc(r.reward.label) +
    '</b>, above the item level your report simmed each drop at — so the scores below are a floor, ' +
    'and they understate this encounter against one that pays a lower track.</div>';
}

/**
 * A pool in three tiers, all of them on screen: the upgrades you're rolling for, the filler that
 * has no value but still dilutes the odds, and what this loot spec can't be handed at all. Only the
 * last is inert — the filler is the half of the pool you most need to *correct*, since marking one
 * Rolled is what takes it out of the denominator.
 */
function itemsHTML(b, r) {
  const showBlocked = active()._showBlockedKey === r.g.key;
  const canGet = r.items.filter((i) => i.elig !== false), blocked = r.items.filter((i) => i.elig === false);
  const upgrades = canGet.filter((i) => i.score > 0), filler = canGet.filter((i) => i.score <= 0);
  const group = (label, n) => '<div class="item-group">' + label + ' <span class="n">' + n + '</span></div>';
  let html = upgrades.map((it) => itemRow(b, it)).join("");
  if (filler.length) {
    html += group(upgrades.length ? "No upgrade — still dilutes the pool" : "Nothing here is an upgrade", filler.length);
    html += filler.map((it) => itemRow(b, it)).join("");
  }
  // The blocked tier is reference, not work: it's out of the pool and can't be changed from here, so
  // it folds away. What it's *for* is the alt-spec lines below, which read from it.
  if (blocked.length) {
    html += '<div class="item-group tap" data-act="showblocked">' +
      (showBlocked ? "Hide" : "Show") + ' what this loot spec can’t be awarded <span class="n">' + blocked.length + '</span></div>';
    if (showBlocked) html += blocked.map((it) => itemRow(b, it)).join("");
  }
  return '<div class="items">' + html + '</div>' + altNotes(b, r);
}

/**
 * What another loot spec would do to this pool. Only better-EV options appear, each named by what
 * it sheds and what it costs — the whole point of switching is usually the dodge, not the gain.
 */
function altNotes(b, r) {
  return r.alts.slice(0, 2).map((a) => {
    const name = esc(specInfo(a.spec).n);
    const delta = a.remaining - r.remaining;
    const parts = ['<b>Loot as ' + name + ':</b> EV ' + dv(b, a.ev) + ' vs ' + dv(b, r.ev) +
      ' · ' + a.remaining + ' in pool' + (delta ? " (" + (delta > 0 ? "+" : "") + delta + ")" : "")];
    if (a.dodges.length) parts.push("Dodges " + listOf(a.dodges));
    if (a.gains.length) parts.push("Adds " + listOf(a.gains));
    if (a.loses.length) parts.push("<b>Gives up " + listOf(a.loses) + "</b>");
    return '<div class="swap-note">' + parts.join(" · ") + "</div>";
  }).join("");
}

/** "A, B and 3 more" — item names for a one-line summary. */
function listOf(names) {
  const head = names.slice(0, 2).map(esc).join(", ");
  return names.length > 2 ? head + " and " + (names.length - 2) + " more" : head;
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
    return '<span class="promoted" title="Drops at ilvl ' + it.lvl + ' — a bonus roll pays out at ilvl ' + lvl + '">' + lvl + '</span>';
  }
  return String(lvl);
}

/** "have 678" on a copy you already hold, gold when rolling it again would only duplicate it. */
function haveBadge(it) {
  if (it.ownedIlvl == null) return "";
  const why = it.dupe
    ? "You already hold this item at ilvl " + it.ownedIlvl + " — rolling here would only duplicate it"
    : (it.rollIlvl
      ? "You hold this at ilvl " + it.ownedIlvl + "; a roll here pays out at ilvl " + it.rollIlvl + " — a real upgrade"
      : "You hold this at ilvl " + it.ownedIlvl + ", but a roll here pays out on a higher upgrade track — probably still an upgrade");
  return '<span class="have' + (it.dupe ? " dupe" : "") + '" title="' + why + '">have ' + it.ownedIlvl + '</span>';
}

function itemRow(b, it) {
  const lvl = rollIlvlOf(it);
  if (it.elig === false) {
    return '' +
      '<div class="item blocked" data-id="' + it.id + '">' +
      '<span class="state-btn blocked" title="A bonus roll can\'t award this to your loot spec">Can\'t</span>' +
      '<div class="iname">' + iconHTML(it.id, lvl) + nameHTML(it.id, it.name, it.q, lvl) +
      '<span class="why">' + esc(it.why || "not for this spec") + '</span></div>' +
      '<div class="ilvl">' + ilvlCell(it) + '</div>' +
      '<div class="iscore tnum">—</div>' +
      '</div>';
  }
  const st = it.state || "want", lbl = st === "want" ? "Want" : (st === "own" ? "Own" : "Rolled");
  const zero = it.score <= 0 ? " zero" : "";
  const only = exclusive(it);
  return '' +
    '<div class="item st-' + st + zero + '" data-id="' + it.id + '">' +
    '<button class="state-btn ' + st + '" data-act="cycle" title="Want → Own → Rolled">' + lbl + '</button>' +
    '<div class="iname">' + iconHTML(it.id, lvl) + nameHTML(it.id, it.name, it.q, lvl) +
    (it.vr ? '<span class="vr">very rare</span>' : '') + only + haveBadge(it) + '</div>' +
    '<div class="ilvl">' + ilvlCell(it) + '</div>' +
    '<div class="iscore tnum">' + (it.score > 0 ? "+" + dv(b, it.score) : "—") + '</div>' +
    '</div>';
}

/**
 * Badge an item that not every spec of the class can be awarded. On something you want that's a
 * reason not to switch; on filler it's the thing another spec would dodge for you.
 */
function exclusive(it) {
  const specs = it.specs || [];
  if (!specs.length || specs.length >= classSpecs(specs[0]).length) return "";
  const names = specs.map((s) => specInfo(s).n).join(" / ");
  return '<span class="only" title="Only ' + esc(names) + ' can be awarded this">' + esc(names) + ' only</span>';
}
