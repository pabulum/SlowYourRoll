// Wowhead links, and the tooltips their widget attaches to them.
//
// Item rows link out to Wowhead; `widgets/power.js` (loaded from index.html) finds those links and
// renders Wowhead's own card on hover — the same one QE Live and Raidbots show, with stats, effects
// and sockets we have no way to reproduce from our database. The widget is configured not to
// rewrite our markup: we already colour names by quality and draw our own icons, and letting it
// re-do that would fight the layout.
//
// The `ilvl` we pass matters. Retail rolls an item's stats from its item level, so the generic card
// describes an item level nothing actually drops at; handing over the drop's own level makes the
// numbers on the card the numbers you'd get.
//
// This is the app's one third-party script, and with it the one thing that tells anybody else what
// you're looking at. Nothing about your report leaves the browser; hovering an item tells Wowhead
// which item you hovered. If the widget is blocked or offline, the links still work as links.

import { QE_DATA } from "./data.js";
import { esc } from "./util.js";

const ICON_CDN = "https://wow.zamimg.com/images/wow/icons/large/";
const WOWHEAD = "https://www.wowhead.com/item=";

/** The `data-wowhead` payload — item id, plus the item level this source drops it at. */
function whAttr(id, lvl) {
  return ' data-wowhead="item=' + id + (lvl ? "&amp;ilvl=" + lvl : "") + '"';
}

/**
 * The item's icon as a Wowhead link. `data-act` marks it for ui.js, whose row handler has to let
 * the click through instead of treating it as a state change.
 */
export function iconHTML(id, lvl) {
  const it = QE_DATA.items[id];
  if (!it || !it.ic) return '<span class="icon blank"></span>';
  return '<a class="icon-link" href="' + WOWHEAD + id + '" target="_blank" rel="noopener"' +
    whAttr(id, lvl) + ' data-act="wowhead">' +
    '<img class="icon" loading="lazy" alt="" src="' + ICON_CDN + esc(it.ic) + '.jpg"' +
    ' onerror="this.style.visibility=\'hidden\'"></a>';
}

/** The item's name as a Wowhead link, coloured by quality. */
export function nameHTML(id, name, q, lvl) {
  return '<a class="iname-link q' + (q || 3) + '" href="' + WOWHEAD + id + '" target="_blank" rel="noopener"' +
    whAttr(id, lvl) + ' data-act="wowhead">' + esc(name) + "</a>";
}
