# Tradewind TPM — presales demo prototype

An ERP-agnostic **Trade Promotion Management & deduction-recovery** prototype for
mid-market CPG manufacturers. Built as a self-contained React app with a rich
seeded dataset — no backend, no accounts, no network calls.

This is the demo build of a product specified in an internal build plan. It
implements that plan's guided-demo arc end to end so it can go in front of a
prospect today; it is **not** the production Supabase build.

```bash
npm install
npm run dev      # http://localhost:5173
```

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → `dist/` (≈112 kB gzipped) |
| `npm test` | 95 unit tests — calc, matching and forecast engines, seed integrity, economics |
| `npm run verify` | Browser smoke test in system Edge + screenshots (28 local, 32 against a deploy) |
| `npm run typecheck` | `tsc --noEmit` |

---

## What's in it

**Product name is a placeholder.** "Tradewind" appears in `index.html`,
`AppShell.tsx` and `package.json` — three places, easy to rename in Phase 0.

The demo tenant is **Cascade Pantry Co.**, a fictional ~$193M CPG manufacturer.
Retailer names are real because trade-promotion people think in terms of Kroger
and Albertsons — abstract names make a TPM demo read as a toy. Every screen
carries a **Demo data** badge so nothing is mistaken for a real commercial record.

| Screen | What it demonstrates |
|---|---|
| **Dashboard** | Money at risk first, then fund pressure, then plan performance. Every tile links into the screen that can act on it. |
| **Deductions** | The wedge. 300 chargebacks scored live by the matching engine into auto-matched / needs review / likely invalid / no match, with a full evidence breakdown per candidate, disputes, aging and recovery economics. |
| **Promotions** | Every event, ranked on **true** ROI (cannibalization and post-promo dip already netted out). |
| **Planning grid** | Excel-grade editing: arrow keys, type-to-edit, Ctrl+C/V over a range as TSV, Ctrl+D fill-down, Ctrl+Z undo. Live P&L recalculates on every keystroke, plus a real-time fund check and SKU-level conflict detection. |
| **Trade calendar** | Customer × week Gantt. Drag to move, drag the trailing edge to extend — both snap to retail weeks. Overlapping events sharing a SKU are outlined in red as you drag. |
| **Forecast** | Driver-based and multi-level. Every cell is `stores × velocity × seasonality × weeks`, rolling up through a hierarchy you choose — customer → product group, brand → customer, channel → customer → group. Editable drivers, bulk update, and a recommendation queue that compares each assumption against recent actuals. |
| **Trade funds** | Balances derived from the transaction ledger on every read, never stored. Click any fund to see the postings behind its number. |
| **Analytics** | Gross-to-net waterfall, quality-of-lift breakdown, spend by tactic, effectiveness leaderboard showing reported ROI struck through next to the true figure. |
| **Settings** | Retune the matching engine and watch all 300 deductions re-score live. Per-customer reason-code mapping table. |

Plus: `Cmd/Ctrl-K` command palette over the whole dataset, dark mode, designed
empty states, and a designed 404.

---

## Architecture

```
src/
├── data/
│   ├── types.ts          canonical domain model, mirrors the plan's
│   │                     core / md / trade / sales / settle schemas
│   ├── catalog.ts        static master data (12 chains → 24 banners, 40 SKUs)
│   ├── tactics.ts        tactic reference + fixed categorical colour slots
│   ├── rng.ts            deterministic PRNG — never Math.random() in seed code
│   └── seed/             market → funds → promotions → sales → deductions
├── lib/
│   ├── fiscal.ts         4-4-5 / 4-5-4 / 13-period calendars, week math
│   └── calc/             THE CALC ENGINE — pure, no I/O, heavily tested
│       ├── money.ts      numeric(18,4) discipline
│       ├── promotion.ts  spend, revenue, margin, ROI, lift, true performance
│       ├── funds.ts      ledger → balance, accruals, carryover
│       ├── baseline.ts   52-week moving average, promoted weeks excluded
│       ├── waterfall.ts  gross-to-net
│       ├── forecast.ts   drivers, hierarchy roll-up, recommendations
│       └── matching.ts   deduction auto-matching
├── store/                zustand store + derived selectors
├── components/           ui primitives, charts, planning grid, app shell
└── pages/                one file per route
```

**`src/lib/calc` is the piece that matters.** It is pure functions with no React
and no data access, exactly as `packages/calc` is specified in the build plan —
so it lifts into the real monorepo unchanged and is already covered by tests.
No business math lives in a component.

---

## Two engines worth reading

### The calculation engine — `src/lib/calc/`

Implements the plan's §3 formulas directly. Money and volume snap to
`numeric(18,4)` at every boundary, not just on display: without it, summing 300
deduction lines drifts by fractions of a cent and a finance user notices the
recon break.

It also models the **honest** numbers the plan calls a differentiator —
cannibalization (lift stolen from sibling SKUs) and pantry loading (the
post-promotion trough) — as first-class outputs. Analytics ranks on
`trueRoi`, not `reportedRoi`, and shows the gap.

### The forecast engine — `src/lib/calc/forecast.ts`

A forecast is never typed in. It is built from three drivers a planner can
defend in a meeting:

```
units = storesSelling × baseVelocityWeekly × seasonality × weeksInPeriod
```

That decomposition is the point. "The number is too high" is unactionable;
"we assumed 189 stores and only 164 have shipped" is a conversation with the
buyer.

Three decisions in it are load-bearing:

- **Fiscal periods, not calendar months.** In a 4-4-5 year a five-week period
  sells ~25% more than a four-week one at identical velocity. Forecasting in
  months smears that across the year and every period reads as a miss. The week
  count sits under each column header for exactly this reason.
- **The hierarchy is a parameter, not a structure.** Drivers live at leaf level
  (customer × product group) and roll up through whatever dimension list the
  planner picks. Swapping `['customer','productGroup']` for `['brand','customer']`
  re-pivots the entire grid without touching a driver, and the grand total is
  invariant — there is a test for that.
- **Drivers only appear where a node resolves to one leaf line.** A store count
  averaged across three retailers is not a number anyone can act on, and showing
  it invites an edit that silently fans out across the roll-up.

The recommendation engine compares each driver against the last thirteen clean
weeks and proposes a specific value. It never rewrites a driver on its own, it
reports **one finding per line per driver** (a drifting velocity drifts in every
open period — saying so three times just triples the queue), and it respects a
planner override rather than nagging about it.

Two things it deliberately does **not** do:

- It does not compare a seasonal recent window against an annual average. Both
  sides are de-seasonalised first, or every summer it would insist beverages are
  under-forecast purely because of the time of year.
- It does not flag "a promotion runs here but the forecast shows no uplift".
  This is a *base* forecast — the history behind it is de-promoted on purpose
  and lift is owned by the promotion plan. Flagging its own correct behaviour as
  a defect is how a tool teaches people to ignore its warnings.

### The matching engine — `src/lib/calc/matching.ts`

Weighted-additive scoring over five signals — customer (22%), date window (26%),
amount (22%), reason code (15%) and product scope (15%) — plus a proportional
lift when the retailer quotes the promotion code. Weighted-additive rather than a
decision tree because an analyst needs to see *which* signal is weak; a tree only
names the leaf it landed on.

Three things in it are load-bearing and were arrived at by measuring, not guessing:

- **Product scope carries real weight.** With a dozen live promotions per
  retailer, some event's claimable spend lands within tolerance of almost any
  deduction amount. Customer + date + amount alone will confidently return the
  wrong answer; brand agreement is what separates the real event from the
  lookalike.
- **The promo-code reference is a proportional lift, not a flat bonus.** An
  additive bonus clamps at 1.0, which silently turns a degraded match into a
  perfect-looking one — the confidence stops meaning anything exactly when it
  matters most.
- **Warnings distinguish hygiene from invalidity.** An unmapped reason code is
  annoying; a shortage code against a promotion, an off-invoice-only event, or a
  claim above what the event can owe are assertions that the money is not owed.
  Only the latter drive the `likely_invalid` bucket — the recovery bucket.

The engine runs **live in the browser** on load, not baked into the seed. Move a
tolerance in Settings and every score in the app changes.

---

## The seeded world

Deterministic — same bytes on every load, so a presenter can refresh mid-demo
and `verify.mjs` can assert against fixed values.

| | |
|---|---|
| Customers | 12 chains → 24 banners, with a real hierarchy the matcher walks |
| Products | 40 SKUs across 3 brands and 3 categories |
| History | 110 weeks of weekly shipment facts (34,650 rows) |
| Promotions | 200 events, ~6.8 lines each, spanning history and two quarters forward |
| Funds | 96 funds across 4 fiscal years, 1,793 ledger postings |
| Deductions | 300 chargebacks, 69 disputes |
| Forecast | 102 planning lines × 48 fiscal periods, ~37 open recommendations |
| Gross sales | ~$193M trailing 52 weeks |
| Trade spend rate | ~12.9% of gross |
| Volume on deal | ~23% |

The numbers are calibrated, not arbitrary. `src/data/seed/economics.test.ts`
guards them: a demo dataset can be internally consistent and still be nonsense to
anyone who knows the industry — half a billion in revenue for a "mid-market"
prospect, or a 3% trade rate when the real range is 12–20%. A CPG trade finance
person reads those in the first thirty seconds.

**Deductions total ~119% of claimable spend.** That 19% excess is the entire
commercial argument, and it is constructed deliberately: legitimate claims are
bounded by each event's remaining claimable headroom, so duplicates, over-claims,
miscoded non-trade charges and orphans are genuinely *excess* rather than just
more of the same.

Off-invoice money is never claimable — it already came off the invoice at order
entry, so a retailer claiming it again is by definition a duplicate. The engine
knows this and says so.

---

## Design system

Tokens live in `src/index.css` and resolve through Tailwind — no ad-hoc hex
values anywhere in the app. Light and dark are both **selected**: the dark
series colours are the same eight hues re-stepped for the dark surface, not an
automatic flip.

Charts follow one categorical palette assigned in **fixed slot order, never
cycled** — a filter that changes the series count never repaints the survivors.
The palette passes every colourblind-separation and contrast gate in both modes
(validated with the dataviz skill's `validate_palette.js`; light mode carries a
sub-3:1 contrast warning on three slots, so **every chart ships a table view**
and direct labels as the documented relief).

Charts are hand-rolled SVG — no charting dependency. Total runtime deps: React,
React Router, Zustand, lucide-react, clsx, date-fns.

---

## Verification

`npm run verify` drives the real app in **system Edge** (`channel: 'msedge'`) —
the Playwright browser CDN is blocked by the corporate proxy, so downloading
Chromium is not an option. Start `npm run dev` first.

It runs assertions across every page — including that a grid edit really does
move the live P&L, that undo restores it, and that tightening a matching
tolerance re-scores the whole book — and writes screenshots to
`verify-screenshots/`. Console errors fail the run.

```
36/36 checks passed            # local dev server
40/40 checks passed            # against https://www.rsmd365.com/trade-pro/
```

Point it at any origin:

```bash
BASE_URL=https://www.rsmd365.com/trade-pro/ node verify.mjs
```

Against a deployed origin it adds four more checks that each static route returns a
genuine **HTTP 200** rather than a 404 body that merely happens to render —
GitHub Pages has no rewrite rules, so the workflow pre-renders each route as a
real directory.

---

## Deploying to GitHub Pages

Deploys automatically. `.github/workflows/deploy.yml` runs on every push to
`main`: typecheck → tests → build → Pages. A failing test blocks the deploy,
because a broken demo is worse than a stale one.

**Live:** <https://www.rsmd365.com/trade-pro/>

To reproduce the deploy build locally:

```bash
BASE_PATH=/trade-pro/ npm run build
cp dist/index.html dist/404.html      # SPA fallback — Pages has no rewrite rules
npx vite preview                      # http://localhost:4173/trade-pro/
```

`vite.config.ts` reads `BASE_PATH`, and the router uses
`basename={import.meta.env.BASE_URL}`, so the same source serves from any subpath.

> `TPM_BUILD_PLAN.md` is gitignored. This repo is public and the plan contains
> pricing, competitive positioning and partner-channel strategy.

---

## What this prototype is not

Deliberately out of scope — these are the production build's job, not the demo's:

- No Supabase, no auth, no RLS, no multi-tenancy enforcement. Every entity
  carries `orgId` so the shapes lift cleanly, but nothing enforces it.
- No ERP connectors. The `integ` schema is modelled in `types.ts` but not built.
- No CSV importer, approval routing engine, or email notifications.
- Baselines are computed by the engine but the override UI is not built.
- Forecast edits are not versioned; there is no scenario compare or consensus
  workflow between demand planning and sales.
- Edits live in memory only — refresh, or **Reset demo**, restores the seed.
