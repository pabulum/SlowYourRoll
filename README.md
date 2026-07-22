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

**The pool is the boss's whole loot table, not just what your report scored.** A report only
evaluates items worth simming, but a bonus roll draws from everything that boss can hand you, so
the rest is filled in from the item database at zero value — it dilutes the odds without adding
upside, which is exactly what it does in game.

**What's in that pool depends on your loot spec.** Blizzard only awards you drops your loot spec
can receive, so items it can't — a plate helm for a monk, a caster trinket for a healer, an
agility weapon for a Mistweaver — are left out of the math entirely and folded away with the
reason attached.

That makes loot spec a lever, not just a filter, and it cuts both ways: switching can *add* items
you want, but more often the win is **dropping** ones you don't. A Mistweaver at Pit of Saron is
the standard case — looting as Windwalker sheds Nevermelting Ice Crystal, which no agility spec
can be given, and keeps every piece of leather. Same wanted value, one fewer item in the pool,
better odds on each. So each encounter is costed as every spec of your class, and any that beats
your current one is offered under the item list, named by what it dodges and what it gives up.
Items only some of your specs can receive are badged as such. Note that your report's *values*
still only describe the spec it was simmed as; the app says so when the two differ.

**Icons and hover cards.** Item names and icons link to Wowhead, and Wowhead's tooltip widget
(`widgets/power.js`, the same one QE Live and Raidbots use) renders its card on hover. Links carry
the item level *this source* drops at, so the card describes the item you'd actually be handed
rather than a generic one. Icons come from Blizzard's icon CDN.

That widget is the app's only third-party script, and the only thing that tells anyone else what
you're doing: hovering an item tells Wowhead which item you hovered. Nothing from your report is
involved either way. Blocked or offline, the links stay links and the app is unaffected.

Items badged **very rare** (and flagged **✦** in the recommendation) are rare off a *boss kill*, but
a bonus roll draws evenly from the pool — so they're weighted no differently here, and their EV is
not discounted. That's intentional: the roll is the one place a very rare item costs the same as
common filler, which is usually a reason to chase it rather than shy off it.

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

The build also downloads Blizzard's item and talent data from [Raidbots](https://www.raidbots.com)
(`equippable-items.json`, `talents.json`) for the one thing QE Live's database can't supply: who is
allowed to loot what. QE's ItemDB is a healer database — every item in it is intellect and none of
it records spec eligibility — so it can't distinguish a healer trinket from the caster-DPS one on
the same boss, and a report will happily list both. Blizzard's spec lists, armor types and primary
stats settle it; see [`src/loot.js`](src/loot.js). Pass `--items=` / `--talents=` (or
`$RAIDBOTS_ITEMS` / `$RAIDBOTS_TALENTS`) to build from saved copies offline.

**What a roll costs and what the season is called** live in [`src/season.js`](src/season.js) —
QE Live doesn't publish those. Season 1 charges 2 tokens for a raid boss and 1 for a M+ dungeon;
Season 2 charges 1 for everything, which materially reorders the rankings. Moving to Season 2 is
`npm run data`, then setting `ACTIVE = 2` in that file.

The app doesn't depend on either being up to date to stay useful. A Droptimizer carries its own
instance, encounter, difficulty and item level inline, so a next-season raid is rankable from the
report alone: unrecognised sources are ranked as normal, flagged in the UI, and named by id rather
than silently dropped. Sources that genuinely can't be bonus-rolled — crafted gear, reputation
vendors, timewalking, world bosses — are recorded at build time in `ignoredInstances` and filtered
out without a warning, as are a raid's non-encounter drops (QE files trash and catalyst loot under
encounter `999`, world drops under a negative encounter id). So the warning only ever means "the
database is behind."

QE Live reports are the exception: they carry only item ids, and the loot table comes entirely from
`data/qe-data.js`. A new season's items won't resolve to any source until you regenerate.

## Running locally

The app uses native ES modules, so it must be served over HTTP (not opened as a `file://`
URL). Any static server works — there is **no build step**, and the shipped site has **no
runtime dependencies**:

```sh
npm run serve                  # http://localhost:8000
npm run serve -- --port=3000   # or set $PORT
```

That's [`scripts/serve.mjs`](scripts/serve.mjs) — a zero-dependency Node static server, so
Node is the only thing you need installed. It sends `cache-control: no-store`, because a
304 on a stale ES module is a confusing way to lose an edit.

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
