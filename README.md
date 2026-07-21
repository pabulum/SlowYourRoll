# Slow Your Roll

A bonus-roll expected-value tracker for **World of Warcraft "Midnight."** Paste an
upgrade report and it ranks every raid boss and Mythic+ dungeon you can bonus-roll by the
expected value of a single token, so you spend tokens where they pay off.

Everything runs client-side in your browser. Reports are fetched directly from
QuestionablyEpic / Raidbots; nothing is uploaded, and your state is saved to `localStorage`
(with JSON export/import for backups).

## The model

```
EV = ( Σ score of items you still want ÷ items still in the pool ) ÷ token cost
```

Item scores come straight from your report — **QE Live** upgrade reports for healers,
**Raidbots Droptimizer** sims for DPS/tanks (values are the DPS gain per drop). Each item in a
pool is in one of three states you can cycle by tapping it:

- **Want** — an upgrade still in the pool; its score counts toward EV.
- **Own** — you have it (or took it from the vault). It still dilutes the pool but is worth 0
  to you. Copies in your `/simc` export at ≥ the drop's item level auto-mark as Own.
- **Rolled** — you already bonus-rolled it; removed from the pool for good.

Optionally paste your in-game `/simc` addon export to fold in this week's Great Vault choices,
auto-mark owned gear, and import your logged bonus-roll history.

## Seasons

Two things are season-dependent, and they're kept apart because they change at different times.

**Which encounters are current** lives in the generated database (`data/qe-data.js`), mirroring
QE Live's own constants. Regenerate it from a local [QuestionablyEpic](https://github.com/Voulk/QuestionablyEpic)
checkout — nothing in it is hand-maintained:

```sh
npm run data                          # uses $QE_PATH, else ~/Projects/QuestionablyEpic
npm run data -- --qe=/path/to/QELive  # explicit checkout
npm run data:check                    # report drift without writing
```

**What a roll costs and what the season is called** live in [`src/season.js`](src/season.js) —
QE Live doesn't publish those. Season 1 charges 2 tokens for a raid boss and 1 for a M+ dungeon;
Season 2 charges 1 for everything, which materially reorders the rankings. Moving to Season 2 is
`npm run data`, then setting `ACTIVE = 2` in that file.

The app doesn't depend on either being up to date to stay useful. A Droptimizer carries its own
instance, encounter, difficulty and item level inline, so a next-season raid is rankable from the
report alone: unrecognised sources are ranked as normal, flagged in the UI, and named by id rather
than silently dropped. Sources that genuinely can't be bonus-rolled — crafted gear, reputation
vendors, timewalking, world bosses — are recorded at build time in `ignoredInstances` and filtered
out without a warning, so the warning only ever means "the database is behind."

QE Live reports are the exception: they carry only item ids, and the loot table comes entirely from
`data/qe-data.js`. A new season's items won't resolve to any source until you regenerate.

## Running locally

The app uses native ES modules, so it must be served over HTTP (not opened as a `file://`
URL). Any static server works — there is **no build step**, and the shipped site has **no
runtime dependencies**:

```sh
npm run serve        # python3 -m http.server 8000, then open http://localhost:8000
```

## Development

Dev tooling (ESLint, TypeScript, the test runner) lives in `devDependencies` — it never ships
to the deployed site. TypeScript runs in **checkJs** mode: the source stays plain `.js`,
type-checked through JSDoc annotations (see [`src/types.js`](src/types.js)), so you get editor
IntelliSense and CI safety without a compile step.

```sh
npm install          # one-time: install dev tooling
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (checkJs)
npm test             # node:test — unit tests for the pure logic
npm run check        # all three, as CI runs them
```

Tests cover the pure logic (the EV model, report/`simc` parsing, formatting) and live in
[`tests/`](tests/). CI runs `lint` + `typecheck` + `test` on every push and PR
(`.github/workflows/ci.yml`).

## Project layout

```
index.html          Thin HTML shell — markup only
src/
  styles.css        All styling (light/dark, theme tokens)
  main.js           Entry point: boots the UI and renders
  data.js           Re-exports the encounter database + difficulty vocabulary
  season.js         Season config: name + token costs (see "Seasons" above)
  store.js          Persistent state (localStorage), boards, save/load
  model.js          The EV model: encounter resolution, grouping, ranking
  reports.js        Loading QE Live and Raidbots Droptimizer reports
  simc.js           Parsing the /simc addon export (vault, owned, roll history)
  render.js         All DOM rendering
  ui.js             Event wiring, theme toggle, export/import
  types.js          JSDoc type definitions (no runtime code)
data/
  qe-data.js        Generated encounter + item database (see src/data.js for its shape)
scripts/
  build-data.mjs    Regenerates data/qe-data.js from a QuestionablyEpic checkout
tests/              Unit tests (node:test)
```

## Deploying to GitHub Pages

The site is fully static. Push to GitHub and enable Pages for the branch/root, or let the
included workflow at `.github/workflows/pages.yml` deploy on every push to `main` (set
Pages → Source to "GitHub Actions" in the repo settings).

## Disclaimer

Slow Your Roll is a fan-made, unofficial tool. It is **not affiliated with, endorsed by, or
sponsored by** Blizzard Entertainment, QuestionablyEpic, or Raidbots. World of Warcraft and
related marks are trademarks of Blizzard Entertainment, Inc.

## License

[MIT](LICENSE) for the application code. Note that `data/qe-data.js` is derived from
QuestionablyEpic / Raidbots data, which carries its own terms — check those before
redistributing the database.
