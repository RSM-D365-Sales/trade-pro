/**
 * Single source of truth for the Trade Promotion Management booth video.
 *
 * Every other file in demo-kit/ derives from this one:
 *   record.mjs        — drives the app and records the tour, scene by scene,
 *                       holding each scene for exactly `seconds`
 *   write-script.mjs  — regenerates voiceover-script.md (timecodes + VO text)
 *                       and injects the script into the cheat sheet
 *   scratch-vo.mjs    — builds a Windows text-to-speech scratch track so the
 *                       narration can be checked against the picture
 *
 * Edit the copy or the timings here, then re-run the scripts. Don't hand-edit
 * voiceover-script.md.
 *
 * Pacing: a relaxed read is ~150 words a minute (2.5 words a second). Each
 * scene's VO should sit just under `seconds * 2.5` words so the narrator is
 * never racing the cut.
 *
 * Figures quoted in the VO and captions are the seed's at AS_OF (the build the
 * video is recorded from is anchored there; see README). Re-anchor, and
 * re-check them against `npm run reconcile`.
 */

/** The as-of day the recorded build is anchored to (VITE_DEMO_TODAY). */
export const AS_OF = '2026-10-07'

export const VIDEO = {
  title: 'Trade Promotion Management',
  company: 'Bluestem Fresh Produce',
  // Hook line from Blustem-company-details/PUN_BANK.md ("Trade Promotion Management")
  tagline: 'Plan it. Fund it. Match it. Calendar-cool.',
  campus: 'Grand Rapids HQ · Trade Marketing',
  // What the title card between loop videos says this clip is
  interstitialSeconds: 12,
  // Pipeline nodes drawn on the title card (keeps the card's layout identical
  // across apps; only the labels change)
  interstitialNodes: [
    { n: 'Plan',  d: 'Events, rates and volumes in a live-P&L grid' },
    { n: 'Fund',  d: 'Accrual and fixed funds, derived from the ledger' },
    { n: 'Match', d: 'Every chargeback scored against the calendar' },
    { n: 'Measure', d: 'True ROI, gross-to-net, sales vs plan' },
  ],
  interstitialErp: 'Customers · items · invoices · deductions',
  // Keep it short: the label sits in the 30 px gap before the D365 node
  interstitialLink: 'OData',
  frame: { width: 1920, height: 1080 },
}

export const SCENES = [
  {
    id: 'dashboard',
    seconds: 7,
    caption: 'Dashboard',
    sub: 'Money at risk first, then funds, then plan performance',
    vo: 'Nora runs trade marketing at Bluestem. Her morning starts with the money at risk.',
    onScreen: '"Good morning, Nora". KPI row: Deductions at risk $2.30M (67 chargebacks), Recovered to date $1.81M, Trade spend rate 11.7%, Gross margin $49.7M; then the Deduction queue card.',
  },
  {
    id: 'deductions',
    seconds: 9,
    caption: 'Match it · Deductions',
    sub: '300 chargebacks, scored live against the promotion calendar',
    vo: 'Match it. Retailers took fourteen million in deductions. The engine scores every one; a hundred and eighteen match themselves.',
    onScreen: 'Deductions: Total deducted $14.4M, Likely invalid or unmatched $2.30M (16.0%), Recovered $1.81M, Still recoverable $1.56M. The verdict filter moves to "Likely invalid 33"; red-flagged rows fill the table.',
  },
  {
    id: 'evidence',
    seconds: 9,
    caption: 'The evidence, not just a verdict',
    sub: 'Customer · date window · amount · reason code · product scope',
    vo: 'Open one and see why. Two point three million has no promotion behind it, and that is worth fighting.',
    onScreen: 'The biggest likely-invalid chargeback opens in the side panel: amount, reason code mapping, candidate promotions with confidence and the warnings that invalidate them. Panel closes without accepting or disputing.',
  },
  {
    id: 'planning',
    seconds: 9,
    caption: 'Plan it · Planning grid',
    sub: 'Spreadsheet-grade editing with a live P&L and fund check',
    vo: 'Plan it. Every event edits like a spreadsheet, with a live P and L and a fund check on every keystroke.',
    onScreen: 'Promotions, filtered to Live; the first live event opens in the planning grid: date timeline, SKU lines with tactic, rate and volume, and the Live P&L card on the right.',
  },
  {
    id: 'calendar',
    seconds: 7,
    caption: 'Calendar-cool · Trade calendar',
    sub: 'Customer × week. Red outlines share a SKU with an overlapping deal.',
    vo: 'The calendar catches overlapping deals on the same item before they double-fund a retailer.',
    onScreen: 'Customer × week Gantt, today line, red-outlined conflict bars (13 conflicts badge at the foot). The cursor rests on a conflicted bar; nothing is dragged.',
  },
  {
    id: 'forecast',
    seconds: 8,
    caption: 'Forecast · driver-based',
    sub: 'Stores × velocity × seasonality × weeks, and what is drifting',
    vo: 'The forecast is built from drivers, and it says which assumption is drifting from actuals.',
    onScreen: 'Forecast grid by customer → product group in fiscal periods; Needs attention 28 (15 high). "View recommendations" opens the queue with current → suggested values. Nothing is applied.',
  },
  {
    id: 'funds',
    seconds: 8,
    caption: 'Fund it · Trade funds',
    sub: 'Every balance derived from the ledger, never stored',
    vo: 'Fund it. Every balance is derived from the ledger, so an over-committed fund shows exactly why.',
    onScreen: 'Trade funds: Funded $58.9M, Committed $13.5M, Settled $10.8M, Remaining $34.5M (4 over-committed). The over-committed Great Lakes Grocers FY26 accrual opens: balance fold and ledger postings.',
  },
  {
    id: 'analytics',
    seconds: 8,
    caption: 'Sales and trade analytics',
    sub: 'Net sales vs plan, then gross to net to margin',
    vo: 'Then the honest view: net sales against plan, and every dollar from gross to margin.',
    onScreen: 'Sales analytics: net sales vs plan by fiscal period and the territory leaderboard; then Trade analytics: Gross sales $211.8M, trade spend $24.9M (11.7%), the gross-to-net waterfall and quality of lift.',
  },
  {
    id: 'end-card',
    seconds: 6,
    caption: 'Trade Promotion Management',
    sub: 'Plan it. Fund it. Match it. Calendar-cool.',
    vo: 'Trade Promotion Management, powered by RSM. Plan it, fund it, match it.',
    onScreen: 'Midnight end card: bluestem mark, Trade Promotion Management, the hook line, Powered by RSM bottom-right.',
  },
]

export const TOTAL_SECONDS = SCENES.reduce((t, s) => t + s.seconds, 0)

/** Alternate openers from PUN_BANK.md — swap into scene 1 if the room wants a hook. */
export const ALT_OPENERS = [
  'Spreadsheets are where margins go to hide. Let\'s go find them.',
  'Here\'s a problem every produce company knows by heart: the retailer short-paid the invoice, and nobody knows which promotion it was for.',
]

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
