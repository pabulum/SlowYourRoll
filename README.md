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

Item scores come straight from your report: **QE Live** upgrade reports for healers, in **HPS**,
and **Raidbots Droptimizer** sims for everyone else, in **DPS**. Either can also be shown as a
percentage of the character's own throughput from the _Units_ control; raw is the default. See
[Reading a report's numbers](#reading-a-reports-numbers) for where each of those comes from.

Each item in a pool is in one of three states you can cycle by tapping it:

- **Want** — an upgrade still in the pool; its score counts toward EV.
- **Own** — you have it (or took it from the vault). It still dilutes the pool but is worth 0
  to you. Anything you hold at ≥ the item level a roll would pay out auto-marks Own, taken from
  the gear the report was run in and from your `/simc` export if you pasted one.
- **Rolled** — you already bonus-rolled it; removed from the pool for good.

**The pool is the boss's whole loot table, not just what your report scored.** A report only
evaluates items worth simming, but a bonus roll draws from everything that boss can hand you, so
the rest is filled in from the item database at zero value — it dilutes the odds without adding
upside, which is exactly what it does in game.

**What's in that pool depends on your loot spec.** Blizzard only awards you drops your loot spec
can receive, so items it can't — a plate helm for a monk, a caster trinket for a healer, an
agility weapon for a Mistweaver — are left out of the math entirely and folded away with the
reason attached.

That makes loot spec a lever, not just a filter, and it cuts both ways: switching can _add_ items
you want, but more often the win is **dropping** ones you don't. A Mistweaver at Twin Fangs is
the standard case — looting as Windwalker sheds Preternatural Antivenom, which no agility spec
can be given, and keeps every piece of leather. Same wanted value, one fewer item in the pool,
better odds on each. So each encounter is costed as every spec of your class, and any that beats
your current one is offered under the item list, named by what it dodges and what it gives up.
Items only some of your specs can receive are badged as such. Note that your report's _values_
still only describe the spec it was simmed as; the app says so when the two differ.

**Icons and hover cards.** Item names and icons link to Wowhead, and Wowhead's tooltip widget
(`widgets/power.js`, the same one QE Live and Raidbots use) renders its card on hover. Links carry
the item level _this source_ drops at, so the card describes the item you'd actually be handed
rather than a generic one. Icons come from Blizzard's icon CDN.

That widget is the app's only third-party script, and the only thing that tells anyone else what
you're doing: hovering an item tells Wowhead which item you hovered. Nothing from your report is
involved either way. Blocked or offline, the links stay links and the app is unaffected.

Items badged **very rare** (and flagged **✦** in the recommendation) are rare off a _boss kill_, but
a bonus roll draws evenly from the pool — so they're weighted no differently here, and their EV is
not discounted. That's intentional: the roll is the one place a very rare item costs the same as
common filler, which is usually a reason to chase it rather than shy off it.

Optionally paste your in-game `/simc` addon export to fold in this week's Great Vault choices,
auto-mark owned gear, and import your logged bonus-roll history.

## Reading a report's numbers

Neither report format is quite what it looks like, and both quirks are load-bearing. The details
below are from QE Live's own source (`UpgradeFinderEngine.js`, `UpgradeFinderFront.js`) rather than
from inspecting payloads, so they name the fields as upstream writes them.

**A QE result carries the same upgrade three times.** `rawDiff` is the HPS gained, `percDiff` is
that same gain as a percentage, and `score` is _whichever of the two the person running the report
had selected_ under QE's "Upgrade Finder metric" setting:

```js
const rawDiff = Math.round(((newScore - baseScore) / baseScore) * baseHPS);
const percDiff = (newScore - baseScore) / baseScore;
if (getSetting(userSettings, "upgradeFinderMetric") === "Show HPS")
  differential = rawDiff;
else differential = percDiff; // ← QE's default
```

That setting defaults to `"Show % Upgrade"`, so `score` on a typical report is a bare ratio like
`0.0234`. Reading it as HPS understates every figure by a factor of the character's throughput, and
makes two reports saved under different settings incomparable. So [`scoreOf`](src/model.js) reads
`rawDiff`, and falls back to `score` only for a report old enough to predate it (QE has sent both
since April 2023).

**That pair is also where the percentage toggle comes from.** QE never sends `baseHPS`, but
`rawDiff / percDiff × 100` recovers it, and it's fixed for the whole report.
[`baselineOf`](src/model.js) sums both fields across every result before dividing, because each is
rounded on the way out (`rawDiff` to an integer, `percDiff` to three decimals) and the small items
are where that hurts. A Droptimizer states its baseline outright, at
`sim.players[0].collected_data.dps.mean`.

**A QE `dropDifficulty` is an index, not a rank.** It indexes QE's own difficulty slider —
`["Raid Finder", "Raid Finder (Max)", "Normal", "Normal (Max)", "Heroic", "Heroic (Max)", "Mythic",
"Mythic (Max)"]` — mirrored as `QE_RAID_DIFFICULTIES` in [`src/data.js`](src/data.js). `(Max)` is
the same difficulty at the top of its upgrade track (QE prices Mythic at 272 and Mythic (Max) at
289), so `diffKey` folds the suffix away before asking the season what a roll pays.

**A QE report also ships the gear it was run in**, as `equippedItems`. Reduced at ingest to
`{ itemId: ilvl }` and merged with any `/simc` data by taking the higher item level, so a healer who
pastes nothing but a report link still gets dupe detection.

Those item levels are whatever QE's import dialog produced, and it has two checkboxes that change
them (`SimCraftDialog.js`, applied in `SimCImportEngine.ts`):

| Checkbox                   | Default | Effect                                                       |
| -------------------------- | ------- | ------------------------------------------------------------ |
| Upgrade ALL to Max Level   | off     | every tracked item is reported at its track's item-level cap |
| Upgrade Vault to Max Level | on      | vault items only are reported at their cap                   |

Taking the higher of report and `/simc` is deliberate, and it makes the app follow whichever
convention the report was made under. Many guilds ask raiders to import with **Upgrade ALL** on, so
that gear they intend to upgrade does not keep showing as a fresh upgrade and prompting a wasted
bonus roll or a NEED in RCLootCouncil. With that box ticked the report states the upgraded item
level, the merge keeps it, and the item marks **Own**. With the defaults it states the real one, and
a roll that pays out higher stays **Want** with a `have N` tag. Neither is overridden.

Two footnotes on that, both observed on real reports:

- **Upgrade ALL only moves items that have an upgrade track.** The guard is
  `if (protoItem.upgradeTrack && protoItem.upgradeTrack in itemLevelCaps)`, so gear from a previous
  expansion is left alone however the box is set.
- **The two sources can disagree without either being stale.** For legacy scaling gear — a line
  carrying `drop_level=` and an old `content_tuning=` — the addon reports an item level QE
  recomputes far lower (554 against 79 on one observed shoulder). Taking the higher value adopts
  the addon's, which for those items is the wrong one. It has no effect in practice because those
  items are not in current bonus-roll pools, and it is preferred to the alternative: a `/simc` is
  refreshed far more often than a report is re-simmed, so on current gear the higher value is
  normally the fresher one.

**The loot spec lives in `/simc`, not in either report.** The addon writes it commented out, as
`# loot_spec=windwalker` under `spec=mistweaver`, because SimulationCraft has no use for it. It is
the only place either format says what Blizzard will actually award against, and for a healer who
loots as a DPS spec to shed intellect trinkets it is not the report's spec. `activeLootSpec` in
[`src/model.js`](src/model.js) prefers an explicit choice in the dropdown, then `/simc`, then the
report's own spec, and ignores a loot spec belonging to another class.

**A vault option's score is the report's score for the _boss's_ drop.** The vault hands you its own
copy of the item, and the two item levels routinely differ — a vault reward arrives at the top of
its track, while the report simmed whatever that boss drops (unless it was imported with **Upgrade
ALL to Max Level**, which brings them back together). Nothing rescales the number, because the
report is the only source of values there is and interpolating one would be inventing it. Instead
the panel names the level the score was earned at whenever it isn't the level on offer, so a figure
quoted against a different item is visibly quoted against a different item. It follows that the
vault verdict is at its sharpest on a report imported with **Upgrade ALL** on.

**QE's `dateCreated` is `"2026 - 7 - 29"`** — spaced separators and a one-digit month, which `Date`
refuses outright. `shortDate` in [`src/render.js`](src/render.js) reads the three numbers out and
constructs the date itself, rather than printing the raw string into the masthead.

## Seasons

Two things are season-dependent, and they're kept apart because they change at different times.

**Which encounters are current** lives in the generated database (`data/qe-data.json`), mirroring
QE Live's own constants. Regenerate it from a local [QuestionablyEpic](https://github.com/Voulk/QuestionablyEpic)
checkout — nothing in it is hand-maintained:

```sh
npm run data                          # uses $QE_PATH, else ~/Projects/QuestionablyEpic
npm run data -- --qe=/path/to/QELive  # explicit checkout
npm run data:check                    # report drift without writing
```

QE writes those databases in TypeScript and renames them between patches (`InstanceDB.js` became
`InstanceDB.ts` on the 12.1 branch), so the build tries both spellings and erases types with Node's
own stripper before evaluating them. A new season usually lands on a patch branch weeks before it
merges, which is the one case where the files have to be read out of a branch rather than a working
tree — `git show`n into a temp directory, so nobody's checkout gets moved off what they were doing.
Provenance is recorded either way: the build stamps `_meta.source` from the checkout's git history,
and `--source=` (or `$QE_SOURCE`) supplies it when there is no history to read, so an extracted
build says which branch it came from instead of `unknown`.

The build also downloads Blizzard's item and talent data from [Raidbots](https://www.raidbots.com)
(`equippable-items.json`, `talents.json`) for the one thing QE Live's database can't supply: who is
allowed to loot what. QE's ItemDB is a healer database — every item in it is intellect and none of
it records spec eligibility — so it can't distinguish a healer trinket from the caster-DPS one on
the same boss, and a report will happily list both. Blizzard's spec lists, armor types and primary
stats settle it; see [`src/loot.js`](src/loot.js). Pass `--items=` / `--talents=` (or
`$RAIDBOTS_ITEMS` / `$RAIDBOTS_TALENTS`) to build from saved copies offline.

**What a roll costs and what the season is called** live in [`src/season.js`](src/season.js) —
QE Live doesn't publish those. Season 1 charges 2 tokens for a raid boss and 1 for a M+ dungeon;
Season 2 charges 1 for everything, which materially reorders the rankings. Moving seasons is
`npm run data`, then setting `ACTIVE` in that file. The app is on Season 2 as of 2026-08-11, the
day patch 12.1 went live; the raid itself opens on the 18th, so through pre-season week it ranks
content that is listed but not yet lootable, and the week copy says so by reporting week 0.

The build warns when the database has moved to a season the build doesn't know about, and it
watches the **current raid list** to do it, not QE's `seasonID`. Upstream carried the same season id
(34) across Midnight's Season 1 → 2 boundary while swapping every raid underneath it, so an id check
would have sat silent through the one rollover it existed to catch. Each season therefore records
the raid ids it expects in `qeRaids`.

Season 2 also promotes what a roll pays out — a Mythic boss hands back a fully upgraded Myth item
rather than the drop — so that season's table carries item levels as well as tracks. They're read
off the 12.1 PTR and pinned in [`tests/season.test.js`](tests/season.test.js), so a PTR revision
fails a test rather than quietly changing everyone's numbers. The M+ figure is the payout for a +10
key or higher; lower keys pay under it, and nothing in a QE report says which key you run.

**The last two bosses of the tier raid are a class apart** — Venomcursed 9/6 items with cantrip
effects — so those encounter cards carry a badge and a note the EV can't express: it prices this
week only, and can't weigh a token banked for kill week against one spent now. Two things about
that are easy to get wrong and are worth stating.

Which bosses are "last" comes from the raid's recorded **pull order**, carried through the data
build as `order`. It used to be derived by sorting encounter ids, on the theory that Blizzard hands
them out in roughly pull order. That held for The Voidspire and fails for Venomous Abyss, which
ends on Coiled Altar (2883) — sixth of eight by id. Sorting badged Lost Explorers instead, which is
the wrong boss to tell someone to bank a token for.

And the badge is gated on the season naming its tier raid (`special.raid`), because Season 2 ranks
two raids: the tier raid and Tidebound Grotto, a one-boss flex world boss. "The last two bosses" of
a one-boss raid is that boss, so without the gate the world boss wore the badge too.

In Season 2 the roll token is itself a Great Vault reward for weeks 2–7, so taking it costs you the
item you'd otherwise have picked; from week 8 it's free again and you get both. That window is a
rule stated in week numbers, which is only useful next to which week it is now — so the season also
carries `week1`, the reset that opens week 1 (August 18, off Larias' week-by-week dates), and both
places that describe the window answer it for today: the reward pane and the vault trade banner.
Before the season opens it names the date instead. The count is anchored to the US reset, which is
the reset those dates are written in; other regions reset later the same day, so at the boundary it
can name a week the reader hasn't reached yet.

All of that is legible in the app from the **S2 rewards** button in the masthead, which opens a
reward pane: what each source pays, at which track and item level, the full M+ ladder the ranking
quotes the top of, the crests a roll banks, and what the rules change about the numbers on the page.
The game shows none of this anywhere — in game a boss drops what it drops, and "your roll pays out
on your _vault's_ track" is a rule you read a guide or install an addon for. The pane is rendered
from [`src/season.js`](src/season.js), so the figures in it are the same ones the ranking prices
with; it's reachable from the legend and from the `pays …` chip on any encounter card too. It's
pinned to Season 2 rather than following `ACTIVE`: Season 1 has no reward scheme to document, and
Season 2's rules are wanted _before_ the season starts. So it always names its season in the
heading, and says whether the ranking behind it is playing by those rules yet.

The app doesn't depend on either being up to date to stay useful. A Droptimizer carries its own
instance, encounter, difficulty and item level inline, so a next-season raid is rankable from the
report alone: unrecognised sources are ranked as normal, flagged in the UI, and named by id rather
than silently dropped. Sources that genuinely can't be bonus-rolled — crafted gear, reputation
vendors, timewalking, world bosses — are recorded at build time in `ignoredInstances` and filtered
out without a warning, as are a raid's non-encounter drops (QE files trash and catalyst loot under
encounter `999`, world drops under a negative encounter id). So the warning only ever means "the
database is behind."

QE Live reports are the exception: they carry only item ids, and the loot table comes entirely from
`data/qe-data.json`. A new season's items won't resolve to any source until you regenerate.

## Sharing a report

The link button next to the report picker copies a link like `…/?report=<code>`. Opening it
loads that report before anything is pasted — handy for handing a character's board to a
guild officer. Only the report id travels: the recipient fetches the same scores fresh from
QE Live / Raidbots, while rolled history, Own/Rolled marks, and token overrides stay in each
person's own browser. Raidbots links expire when the underlying report does (~30 days).

## Running locally

The app uses native ES modules, so it must be served over HTTP (not opened as a `file://`
URL). Any static server works — there is **no build step**, and the shipped site has **no
runtime dependencies**:

```sh
npm run dev                  # http://localhost:8000
npm run dev -- --port=3000   # or set $PORT
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
npm test             # node:test
npm run check        # all three, as CI runs them
```

CI runs `lint` + `typecheck` + `test` on every push and PR (`.github/workflows/ci.yml`).

### Building markup

Every name on the page is text somebody else wrote — item names from QE Live's database, character
and realm names from a pasted report. So markup is built with the `html` tagged template in
[`src/html.js`](src/html.js), which **escapes every interpolated value** unless it is explicitly
marked as markup:

```js
html`<div class="${cls}">${item.name}</div>`; // both escaped
html`<ul>
  ${rows.map(rowHTML)}
</ul>`; // arrays join; nested html`` passes through
html`${cond && html`<b>only sometimes</b>`}`; // false / null / undefined render as nothing
```

Safety is the default rather than a discipline: there is no `esc()` to forget. The one way past it
is `raw()`, which is what to grep for when auditing. Interpolations are safe in text and in
_double-quoted_ attributes — write `class="${x}"`, never `class='${x}'`.

### Reaching the page

Element ids are declared once, in [`src/dom.js`](src/dom.js). `$` is typed against that list, so a
rename in `index.html` is a type error everywhere the id is used rather than a `null` at runtime,
and a missing element throws with its own name attached. `tests/dom.test.js` checks the list
against the real markup in both directions — an id the app wants that the page lost, and an
element in the page that nothing renders into.

### Tests

Tests run under `node:test` and live in [`tests/`](tests/). The pure logic is covered directly (the
EV model, loot eligibility, report and `simc` parsing, the escaping contract). Rendering and event
wiring are covered against **the real `index.html`**, parsed with `linkedom` — so a test can fail
because an element id moved, because a fragment never reached the DOM, or because a hostile item
name arrived as markup. A stub DOM that answers every lookup with the same object would agree with
any markup at all, including markup that isn't there, which is why there isn't one.

## Project layout

```
index.html          Thin HTML shell — markup only
src/
  styles.css        All styling (light/dark, theme tokens)
  main.js           Entry point: boots the UI and renders
  data.js           Re-exports the encounter database + difficulty vocabulary
  season.js         Season config: name + token costs (see "Seasons" above)
  store.js          Persistent state (localStorage), boards, save/load
  model.js          The EV model: encounter resolution, grouping, ranking, display scaling
  loot.js           Who can be awarded what — loot spec eligibility
  classes.js        Game constants: armor types, weapon training, class colours
  reports.js        Loading QE Live and Raidbots Droptimizer reports
  simc.js           Parsing the /simc addon export (vault, owned, roll history)
  render.js         All DOM rendering
  ui.js             Event wiring, theme toggle, export/import
  html.js           The `html` tagged template — escaping by default
  dom.js            Element-id registry, typed `$`, and the mutations the app makes
  wowhead.js        Item links and the tooltip widget's payload
  types.js          JSDoc type definitions (no runtime code)
data/
  qe-data.json      Generated encounter + item database (see src/types.js QEData for its shape)
scripts/
  build-data.mjs    Regenerates data/qe-data.json from a QuestionablyEpic checkout
  serve.mjs         Zero-dependency static server for local development
tests/              node:test suites; page.js supplies the real DOM
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

[MIT](LICENSE) for the application code. Note that `data/qe-data.json` is derived from
QuestionablyEpic / Raidbots data, which carries its own terms — check those before
redistributing the database.
