// The share Worker's entry point; card.js is the Worker itself. The database is bundled in at
// deploy rather than fetched: a card only needs names and icons from it, and those change at a
// season boundary, not with each data refresh.

import data from "../data/qe-data.json" with { type: "json" };
import { handle } from "./card.js";

export default {
  /** @param {Request} req */
  fetch(req) {
    return handle(req, /** @type {any} */ (data));
  },
};
