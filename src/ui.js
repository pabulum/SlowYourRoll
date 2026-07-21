// Wires up all user interaction: encounter/item clicks, difficulty & metric toggles,
// board switching, export/import, and the theme toggle.

import { state, save, active, replaceState } from "./store.js";
import { $, toast } from "./util.js";
import { render } from "./render.js";
import { loadReport } from "./reports.js";
import { readSimc } from "./simc.js";

export function initUI() {
  // Encounter list — expand/collapse, reveal zero-score fillers, cycle item state.
  $("sources").addEventListener("click", (/** @type {any} */ e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const card = e.target.closest(".card");
    if (!card) return;
    const b = active(), key = card.dataset.key, act = el.dataset.act;
    if (act === "toggle") { b._open = (b._open === key ? null : key); save(); render(); return; }
    if (act === "showzero") { b._showZeroKey = (b._showZeroKey === key ? null : key); render(); return; }
    const itemEl = e.target.closest(".item");
    if (act === "cycle" && itemEl) {
      const id = itemEl.dataset.id, ok = key + ":" + id;
      const cur = b.overlay[ok] || "want";
      const nxt = cur === "want" ? "own" : (cur === "own" ? "rolled" : "want");
      if (nxt === "want") delete b.overlay[ok]; else b.overlay[ok] = nxt;
      save(); render();
    }
  });

  // Per-encounter token cost override.
  $("sources").addEventListener("change", (/** @type {any} */ e) => {
    const el = e.target.closest('[data-act="cost"]');
    if (!el) return;
    const card = e.target.closest(".card"), b = active(), key = card.dataset.key;
    b.tokenOverride[key] = Math.max(1, parseInt(el.value, 10) || 1);
    save(); render();
  });

  $("diffSeg").addEventListener("click", (/** @type {any} */ e) => {
    const el = e.target.closest("[data-diff]");
    if (!el) return;
    active().raidDiff = el.dataset.diff; save(); render();
  });
  $("metricSeg").addEventListener("click", (/** @type {any} */ e) => {
    const el = e.target.closest("[data-metric]");
    if (!el) return;
    active().metric = el.dataset.metric; save(); render();
  });
  $("boardSel").addEventListener("change", (/** @type {any} */ e) => { state.activeId = e.target.value; save(); render(); });
  $("delBoard").addEventListener("click", () => {
    const b = active();
    if (!confirm("Remove " + b.player + " (" + b.spec + ")? Your rolled history for it is lost.")) return;
    state.boards = state.boards.filter((x) => x.id !== b.id);
    state.activeId = (state.boards[0] || {}).id || null;
    save(); render(); toast("Removed");
  });
  $("showAll").addEventListener("change", (/** @type {any} */ e) => { state.showAll = e.target.checked; save(); render(); });

  $("loadBtn").addEventListener("click", loadReport);
  $("reportInput").addEventListener("keydown", (e) => { if (e.key === "Enter") loadReport(); });
  $("simcBtn").addEventListener("click", readSimc);

  // Vault — mark a pick as "taking it" (folds it into the ranking as Own).
  $("vaultPanel").addEventListener("click", (/** @type {any} */ e) => {
    const el = e.target.closest("[data-vault]");
    if (!el) return;
    const b = active(), id = Number(el.dataset.vault);
    b.vaultTake = (b.vaultTake === id ? null : id);
    save(); render();
  });

  // Export / import a JSON backup.
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "slowyourroll-backup.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (/** @type {any} */ e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(String(rd.result));
        if (!p.boards) throw new Error("bad");
        replaceState(p); save(); render();
        toast("Imported " + p.boards.length + " report" + (p.boards.length === 1 ? "" : "s"));
      } catch (err) {
        toast("Couldn't read that file — is it a Slow Your Roll backup?");
      }
      e.target.value = "";
    };
    rd.readAsText(f);
  });

  // Theme toggle (defaults to the OS preference until first click).
  $("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    let cur = root.getAttribute("data-theme");
    if (!cur) cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });
}
