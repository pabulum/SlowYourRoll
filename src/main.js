// App entry point: paint the shell, then fetch the encounter database.
//
// The order matters. renderSeason/initUI/render need no item data — with no report loaded they draw
// the season note, wire the handlers and show the paste prompt — so they run first and the page is
// interactive before the database is asked for. render() draws a loading state if a saved report is
// waiting on data, and is called again once it lands.

import { loadQEData } from "./data.js";
import { setHTML } from "./dom.js";
import { html } from "./html.js";
import { initUI } from "./ui.js";
import { render, renderSeason } from "./render.js";
import { loadSharedReport } from "./reports.js";

renderSeason();
initUI();
render();

loadQEData().then(
  () => {
    render();
    loadSharedReport();
  },
  () => {
    setHTML(
      "sources",
      html`<div class="empty-state">
        <div class="big">⚠️</div>
        <div>
          Couldn't load the encounter database (<code>data/qe-data.json</code>).
        </div>
        <div class="sub">
          Make sure the page is served with that file alongside it.
        </div>
      </div>`,
    );
  },
);
