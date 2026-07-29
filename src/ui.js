// Wires up all user interaction: encounter/item clicks, difficulty & metric toggles,
// board switching, export/import, and the theme toggle.
//
// Every listener is bound once, to a container that outlives the content inside it. The app
// re-renders each panel wholesale on every change, so a listener attached to a row would be
// thrown away with the row it was attached to — see `on` below.

import { state, save, active, replaceState } from "./store.js";
import { $, toast, setShown } from "./dom.js";
import { render, closeBoardMenu } from "./render.js";
import { loadReport } from "./reports.js";
import { readSimc } from "./simc.js";

/**
 * Delegate an event on a container to the nearest matching element at or above the target.
 * @param {import("./dom.js").ElementId} id  Container that survives re-rendering.
 * @param {string} type
 * @param {string} selector  What the click has to have landed inside to count.
 * @param {(el: any, e: any) => void} fn  Called with that element.
 */
function on(id, type, selector, fn) {
  $(id).addEventListener(type, (e) => {
    const el = /** @type {any} */ (e.target).closest(selector);
    if (el) fn(el, e);
  });
}

/** Persist, then redraw — what any change that should outlive this page view needs. */
function commit() {
  save();
  render();
}

/**
 * Want → Own → Rolled → Want. "Want" is the absence of an override rather than a value of one, so
 * the overlay only ever holds the states a user actually asserted — which is what keeps a stored
 * board meaningful after the report behind it is reloaded with different items.
 */
function cycleItem(b, key, itemEl) {
  if (!itemEl) return;
  const k = key + ":" + itemEl.dataset.id;
  const next = { want: "own", own: "rolled", rolled: "want" }[
    b.overlay[k] || "want"
  ];
  if (next === "want") delete b.overlay[k];
  else b.overlay[k] = next;
  commit();
}

/**
 * The report picker: a menu rather than a <select> because the rows carry a class colour, the
 * spec, and where the numbers came from — a native option list can hold none of that, and with
 * several specs of one character loaded those are the only things telling the rows apart.
 * Rows are real buttons, so Tab/Enter/Space work on their own; this adds arrows and Escape.
 */
function initBoardPicker() {
  const btn = $("boardBtn"),
    menu = $("boardMenu");
  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector(".popt.on") || menu.querySelector(".popt");
    if (first) first.focus();
  };

  btn.addEventListener("click", () => {
    if (menu.hidden) open();
    else closeBoardMenu();
  });
  on("boardMenu", "click", "[data-board]", (el) => {
    state.activeId = el.dataset.board;
    commit();
    btn.focus();
  });

  $("boardPicker").addEventListener("keydown", (/** @type {any} */ e) => {
    if (e.key === "Escape" && !menu.hidden) {
      closeBoardMenu();
      btn.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (menu.hidden) {
      open();
      return;
    }
    const opts = [...menu.querySelectorAll(".popt")];
    if (!opts.length) return;
    const i = opts.indexOf(document.activeElement),
      d = e.key === "ArrowDown" ? 1 : -1;
    const next =
      i < 0
        ? opts[d > 0 ? 0 : opts.length - 1]
        : opts[(i + d + opts.length) % opts.length];
    next.focus();
  });

  // Anywhere outside closes it, the way a dropdown is expected to behave.
  document.addEventListener("click", (/** @type {any} */ e) => {
    if (!menu.hidden && !e.target.closest("#boardPicker")) closeBoardMenu();
  });
}

/**
 * Open the reward pane. Assigned by `initRewardPane`; a no-op before then, and referenced from the
 * encounter list, which is rendered long after the pane is wired.
 * @type {(from?: any) => void}
 */
let openRewards = () => {};

/**
 * The reward pane — a dialog, not a menu. It's a page of reference read *against* the ranking
 * rather than a step in any flow, so it opens over the page and closing it puts you back where you
 * were: Escape and the scrim both close it, and focus returns to whatever opened it, which is not
 * always the masthead button — the legend and every encounter card can open it too.
 */
function initRewardPane() {
  const pane = $("rewardPane"),
    btn = $("rewardBtn");
  /** What to hand focus back to. Remembered on the way in, since there are several ways in. */
  let opener = null;

  openRewards = (from) => {
    opener = from || btn;
    setShown("rewardPane", true);
    btn.setAttribute("aria-expanded", "true");
    // The drawer scrolls; the page under it must not, or a scroll gesture at the edge of the panel
    // moves the ranking instead and the pane's position is lost.
    document.body.classList.add("drawer-open");
    $("rewardClose").focus();
  };
  const close = () => {
    if (pane.hidden) return;
    setShown("rewardPane", false);
    btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-open");
    if (opener) opener.focus();
  };

  btn.addEventListener("click", () =>
    pane.hidden ? openRewards(btn) : close(),
  );
  $("rewardClose").addEventListener("click", close);
  on("rewardPane", "click", "[data-close]", close);
  on("rewardLink", "click", '[data-act="rewards"]', (el) => openRewards(el));
  document.addEventListener("keydown", (/** @type {any} */ e) => {
    if (e.key === "Escape") close();
  });
}

/** Download the whole state as a JSON backup, and read one back. */
function initBackup() {
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "slowyourroll-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
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
        if (!p.boards) throw new Error("not a backup");
        replaceState(p);
        commit();
        toast(
          "Imported " +
            p.boards.length +
            " report" +
            (p.boards.length === 1 ? "" : "s"),
        );
      } catch (err) {
        toast("Couldn't read that file. Is it a Slow Your Roll backup?");
      }
      e.target.value = "";
    };
    rd.readAsText(f);
  });
}

export function initUI() {
  // Encounter list — expand/collapse, reveal what this loot spec can't be given, cycle item state.
  on("sources", "click", "[data-act]", (el) => {
    const card = el.closest(".card");
    if (!card) return;
    const b = active(),
      key = card.dataset.key,
      act = el.dataset.act;
    if (act === "wowhead") return; // the icon is a plain link out; let the browser have it
    if (act === "rewards") {
      // The "pays Myth 6/6" chip and the end-of-raid badge are the two claims on a card that come
      // from the season's rules rather than from the report, so they're where the rules belong.
      openRewards(el);
    } else if (act === "toggle") {
      b._open = b._open === key ? null : key;
      commit();
    } else if (act === "showblocked") {
      // Redrawn but not saved: which pool you last unfolded is not a thing to restore a week later.
      b._showBlockedKey = b._showBlockedKey === key ? null : key;
      render();
    } else if (act === "cycle") {
      cycleItem(b, key, el.closest(".item"));
    }
  });

  // Per-encounter token cost override.
  on("sources", "change", '[data-act="cost"]', (el) => {
    active().tokenOverride[el.closest(".card").dataset.key] = Math.max(
      1,
      parseInt(el.value, 10) || 1,
    );
    commit();
  });

  on("diffSeg", "click", "[data-diff]", (el) => {
    active().raidDiff = el.dataset.diff;
    commit();
  });
  on("metricSeg", "click", "[data-metric]", (el) => {
    active().metric = el.dataset.metric;
    commit();
  });

  // Vault — mark a pick as "taking it" (folds it into the ranking as Own).
  on("vaultPanel", "click", "[data-vault]", (el) => {
    const b = active(),
      id = Number(el.dataset.vault);
    b.vaultTake = b.vaultTake === id ? null : id;
    commit();
  });

  initBoardPicker();
  initRewardPane();

  // Changing loot spec changes which drops you're eligible for, and so the whole ranking.
  $("lootSpecSel").addEventListener("change", (/** @type {any} */ e) => {
    active().lootSpec = e.target.value || null;
    commit();
  });

  // Share the active report as a ?report= link. What travels is the report id alone —
  // the recipient fetches the same scores fresh; rolled history and overrides stay local.
  $("shareBoard").addEventListener("click", () => {
    const b = active();
    const url =
      location.href.replace(/[?#].*$/, "") +
      "?report=" +
      encodeURIComponent(b.reportId);
    navigator.clipboard.writeText(url).then(
      () =>
        toast(
          b.source === "droptimizer"
            ? "Link copied. Raidbots reports expire after ~30 days"
            : "Link copied. It opens with " + b.player + "'s report loaded",
        ),
      () => prompt("Copy this link:", url),
    );
  });

  $("delBoard").addEventListener("click", () => {
    const b = active();
    if (
      !confirm(
        "Remove " +
          b.player +
          " (" +
          b.spec +
          ")? Your rolled history for it is lost.",
      )
    )
      return;
    state.boards = state.boards.filter((x) => x.id !== b.id);
    state.activeId = (state.boards[0] || {}).id || null;
    commit();
    toast("Removed");
  });

  $("showAll").addEventListener("change", (/** @type {any} */ e) => {
    state.showAll = e.target.checked;
    commit();
  });

  $("loadBtn").addEventListener("click", loadReport);
  $("reportInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadReport();
  });
  $("simcBtn").addEventListener("click", readSimc);

  initBackup();

  // Theme toggle (defaults to the OS preference until first click).
  $("themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const cur =
      root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });
}
