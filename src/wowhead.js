// Wowhead links, and the tooltips their widget attaches to them.
//
// Item rows link out to Wowhead; `widgets/power.js` (loaded from index.html) finds those links and
// renders Wowhead's own card on hover — the same one QE Live and Raidbots show, with stats, effects
// and sockets we have no way to reproduce from our database. The widget is configured not to
// rewrite our markup: we already colour names by quality and draw our own icons, and letting it
// re-do that would fight the layout.
//
// The `ilvl` we pass matters. Retail rolls an item's stats from its item level, so the generic card
// describes an item level nothing actually drops at; handing over the level the row is about makes
// the numbers on the card the numbers you'd get. Which level that is belongs to the caller: it is
// the one the row's score was simmed at, so a card and the score beside it describe one item. See
// `shownIlvl` in render.js.
//
// This is the app's one third-party script, and with it the one thing that tells anybody else what
// you're looking at. Nothing about your report leaves the browser; hovering an item tells Wowhead
// which item you hovered. If the widget is blocked or offline, the links still work as links.

import { QE_DATA } from "./data.js";
import { html, raw } from "./html.js";

const ICON_CDN = "https://wow.zamimg.com/images/wow/icons/large/";
const WOWHEAD = "https://www.wowhead.com/item=";

/**
 * The `data-wowhead` payload — item id, plus the item level the row is showing. The separator
 * is a literal `&amp;` because the widget reads the attribute after the parser has unescaped it;
 * `raw` because it is markup, written here, not a value from anywhere.
 */
function whAttr(id, lvl) {
  return raw(
    'data-wowhead="item=' +
      Number(id) +
      (lvl ? `&amp;ilvl=${Number(lvl)}` : "") +
      '"',
  );
}

/**
 * The item's icon as a Wowhead link. `data-act` marks it for ui.js, whose row handler has to let
 * the click through instead of treating it as a state change.
 */
export function iconHTML(id, lvl) {
  const it = QE_DATA.items[id];
  if (!it?.ic) return html`<span class="icon blank"></span>`;
  return html`<a
    class="icon-link"
    href="${WOWHEAD + id}"
    target="_blank"
    rel="noopener"
    ${whAttr(id, lvl)}
    data-act="wowhead"
    ><img
      class="icon"
      loading="lazy"
      alt=""
      src="${`${ICON_CDN + it.ic}.jpg`}"
      onerror="this.style.visibility='hidden'"
  /></a>`;
}

/** The item's name as a Wowhead link, coloured by quality. */
export function nameHTML(id, name, q, lvl) {
  return html`<a
    class="iname-link q${q || 3}"
    href="${WOWHEAD + id}"
    target="_blank"
    rel="noopener"
    ${whAttr(id, lvl)}
    data-act="wowhead"
    >${name}</a
  >`;
}
