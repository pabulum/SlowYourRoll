// App entry point: verify the encounter database loaded, wire up the UI, and render.

import { QE_DATA } from "./data.js";
import { setHTML } from "./dom.js";
import { html } from "./html.js";
import { initUI } from "./ui.js";
import { render, renderSeason } from "./render.js";
import { loadSharedReport } from "./reports.js";

if (!QE_DATA) {
  setHTML("sources", html`<div class="empty-state"><div class="big">⚠️</div><div>Couldn't load the
    encounter database (<code>data/qe-data.js</code>).</div><div class="sub">Make sure the page is
    served with that file alongside it.</div></div>`);
} else {
  renderSeason();
  initUI();
  render();
  loadSharedReport();
}
