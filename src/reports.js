// Loading and ingesting external reports. Two sources are supported:
//   - QE Live upgrade reports (healers): item values are QE scores.
//   - Raidbots Droptimizer (DPS/tanks): item values are the DPS gain from each drop.
// Everything is fetched client-side; nothing is uploaded.

import { state, save, keyOf, uid } from "./store.js";
import { $, toast } from "./util.js";
import { parseSimc, applySimc } from "./simc.js";
import { render } from "./render.js";

const QE_API = "https://questionablyepic.com/api/getUpgradeReport.php?reportID=";
const DROPT_URL = "https://www.raidbots.com/reports/";

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

/** Load whichever report is in the input box and merge it into state. */
export function loadReport() {
  const d = detectSource($("reportInput").value);
  if (!d) { toast("Paste a QE Live or Raidbots report link (or code)"); return; }
  const btn = $("loadBtn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  const done = () => { btn.disabled = false; btn.textContent = "Load report"; };

  if (d.source === "qe") {
    fetch(QE_API + encodeURIComponent(d.id))
      .then((r) => r.json())
      .then((data) => {
        if (typeof data === "string") data = JSON.parse(data);
        if (!data || data.status === "Report not found" || !data.results) throw new Error("nf");
        ingest(d.id, data);
      })
      .catch(() => toast("Couldn't load that QE report — check the code, or QE may be down"))
      .then(done);
  } else {
    fetch(DROPT_URL + encodeURIComponent(d.id) + "/data.json")
      .then((r) => { if (!r.ok) throw new Error("nf"); return r.json(); })
      .then((data) => ingestDroptimizer(d.id, data))
      .catch(() => toast("Couldn't load that Raidbots report — it may have expired (they're kept ~30 days)"))
      .then(done);
  }
}

/* ---------- Raidbots Droptimizer ----------
   profileset name = "instId/encId/difficulty/itemId/ilvl/enchant/slot///" */
export function parseDroptimizer(data) {
  const sim = data.sim || {}, p0 = (sim.players || [])[0] || {}, sb = data.simbot || {};
  const baseline = (((p0.collected_data || {}).dps || {}).mean) || 0;
  const results = (sim.profilesets || {}).results || [];
  const idn = sb.input
    ? parseSimc(sb.input)
    : { name: sb.player || p0.name, realm: null, spec: sb.spec || p0.specialization || "" };
  if (!idn.name) idn.name = sb.player || p0.name || "Droptimizer";
  if (!idn.spec) idn.spec = sb.spec || p0.specialization || "";

  const byKey = {};
  results.forEach((r) => {
    const f = String(r.name || "").split("/");
    if (f.length < 5) return;
    const inst = parseInt(f[0], 10), enc = parseInt(f[1], 10), diff = f[2] || "",
      item = parseInt(f[3], 10), lvl = parseInt(f[4], 10) || 0;
    if (!item || isNaN(inst) || isNaN(enc)) return;
    const delta = (r.mean || 0) - baseline, k = inst + ":" + enc + ":" + item, ex = byKey[k];
    if (!ex || delta > ex.rawDelta) {
      byKey[k] = { item, inst, enc, diff, level: lvl, rawDelta: delta, score: Math.max(0, Math.round(delta * 10) / 10) };
    }
  });
  return { idn, baseline, results: Object.keys(byKey).map((x) => byKey[x]) };
}

function ingestDroptimizer(id, data) {
  const d = parseDroptimizer(data);
  if (!d.results.length) { toast("No drop results in that report — was it a gear/stat sim instead of a Droptimizer?"); return; }
  const k = keyOf(d.idn.name, d.idn.realm, d.idn.spec);
  let b = state.boards.filter((x) => x.key === k)[0];
  if (b) {
    b.reportId = id; b.results = d.results; b.baseline = d.baseline; b.source = "droptimizer";
    b.spec = d.idn.spec || b.spec;
    toast("Updated " + d.idn.name + " (Droptimizer)");
  } else {
    b = {
      id: uid(), key: k, reportId: id, player: d.idn.name || "Unknown", realm: d.idn.realm || "", region: d.idn.region || "",
      spec: d.idn.spec || "", source: "droptimizer", metric: "raw", baseline: d.baseline, gameType: "Retail", fetchedAt: "",
      results: d.results, ufSettings: {}, raidDiff: null, tokenRaid: 1, tokenDungeon: 1,
      vaultTake: null, overlay: {}, tokenOverride: {},
    };
    state.boards.push(b);
    toast("Loaded " + b.player + " (Droptimizer)");
  }
  applySimc(b);
  state.activeId = b.id;
  $("reportInput").value = "";
  save(); render();
}

function ingest(code, data) {
  // Update the existing board for the same character (name+realm+spec), else create one.
  const k = keyOf(data.playername, data.realm, data.spec);
  let b = state.boards.filter((x) => x.key === k)[0];
  if (b) {
    b.reportId = code; b.results = data.results; b.ufSettings = data.ufSettings || {}; b.contentType = data.contentType;
    b.fetchedAt = data.dateCreated || ""; b.gameType = data.gameType || "Retail";
    toast("Updated " + (data.playername || "report") + " — rolled history kept");
  } else {
    b = {
      id: uid(), key: k, reportId: code, source: "qe", unit: "value", player: data.playername || "Unknown",
      realm: data.realm || "", region: data.region || "", spec: data.spec || "", contentType: data.contentType || "",
      gameType: data.gameType || "Retail", fetchedAt: data.dateCreated || "", results: data.results,
      ufSettings: data.ufSettings || {}, raidDiff: null, tokenRaid: 1, tokenDungeon: 1,
      vaultTake: null, overlay: {}, tokenOverride: {},
    };
    state.boards.push(b);
    toast("Loaded " + b.player + " — " + b.spec);
  }
  applySimc(b);
  state.activeId = b.id;
  $("reportInput").value = "";
  save(); render();
}
