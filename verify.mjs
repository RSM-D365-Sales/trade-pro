/**
 * Browser smoke test.
 *
 * Drives the real app in system Edge (`channel: 'msedge'`) because the
 * Playwright browser CDN is blocked by the corporate proxy — downloading
 * Chromium is not an option here.
 *
 * Run:  npm run dev   (in one terminal)
 *       npm run verify
 *
 * Or point it at any origin:  BASE_URL=http://localhost:4173 node verify.mjs
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// Normalised without a trailing slash so `${BASE}/analytics` never produces a
// double slash — the deployed URL (https://…/trade-pro/) has one, the dev
// server does not.
const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '')
const SHOTS = 'verify-screenshots'
const HEADLESS = process.env.HEADED !== '1'

const results = []
let failures = 0

function check(condition, name, detail = '') {
  const ok = !!condition
  if (!ok) failures += 1
  results.push({ name, ok, detail })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: 'msedge', headless: HEADLESS })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // ── Dashboard ──────────────────────────────────────────────────────────
  console.log('\nDashboard')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Deductions at risk', { timeout: 20000 })
  check(page.url().startsWith(BASE), 'app boots at the dashboard')
  // Note: the no-trailing-slash form ('/trade-pro') is NOT asserted here.
  // GitHub Pages 301-redirects directory paths to the trailing-slash form,
  // but `vite preview` returns a bare 404 — so the check would fail locally
  // and pass in production. The router's basename is stripped of its trailing
  // slash (see main.tsx) so the app renders either way if a host serves both.
  check(
    await page.locator('text=Cascade Pantry Co.').first().isVisible(),
    'demo tenant is named in the shell',
  )
  const atRisk = await page.locator('text=Deductions at risk').first().locator('..').innerText()
  check(/\$\d/.test(atRisk), 'deductions-at-risk tile shows a dollar figure', atRisk.split('\n')[1])
  await shot(page, '01-dashboard')

  // ── Deductions: the flagship ───────────────────────────────────────────
  console.log('\nDeductions')
  await page.click('a[href$="/deductions"]')
  await page.waitForSelector('text=Engine verdict', { timeout: 20000 })

  const bucketCounts = {}
  for (const label of ['Auto-matched', 'Needs review', 'Likely invalid', 'No match']) {
    const btn = page.locator('button', { hasText: new RegExp(`^${label}\\s*\\d+$`) }).first()
    const text = await btn.innerText().catch(() => '')
    const n = Number(text.replace(/[^\d]/g, ''))
    bucketCounts[label] = n
    check(n > 0, `"${label}" bucket is populated`, `${n} deductions`)
  }
  check(
    Object.values(bucketCounts).reduce((a, b) => a + b, 0) === 300,
    'buckets account for all 300 deductions',
    JSON.stringify(bucketCounts),
  )
  await shot(page, '02-deductions')

  // Open the largest deduction and inspect the engine's evidence.
  await page.locator('table tbody tr').first().click()
  await page.waitForSelector('text=Candidate promotions', { timeout: 10000 })
  const drawer = page.locator('div[role="dialog"]').first()
  check(await drawer.isVisible(), 'match review drawer opens')
  const drawerText = await drawer.innerText()
  check(/amount deducted/i.test(drawerText), 'drawer shows the claim')
  check(
    /product scope/i.test(drawerText) && /date window/i.test(drawerText),
    'signal breakdown is rendered',
  )
  await shot(page, '03-match-review')
  await page.keyboard.press('Escape')

  // Filter to the money bucket.
  await page.locator('button', { hasText: /^Likely invalid/ }).first().click()
  await page.waitForTimeout(300)
  const invalidRows = await page.locator('table tbody tr').count()
  check(invalidRows > 0, 'likely-invalid filter returns rows', `${invalidRows} rows`)
  await shot(page, '04-likely-invalid')

  // ── Promotions + planning grid ─────────────────────────────────────────
  console.log('\nPlanning grid')
  await page.click('a[href$="/promotions"]')
  await page.waitForSelector('text=Committed trade spend', { timeout: 20000 })
  await shot(page, '05-promotions')

  await page.locator('table tbody tr').first().click()
  await page.waitForSelector('text=Live P&L', { timeout: 20000 })
  check(await page.locator('text=Event windows').first().isVisible(), 'six-date timeline renders')
  check(
    await page.locator('[role="grid"]').first().isVisible(),
    'planning grid renders',
  )

  // Edit a cell and prove the P&L recalculates from it.
  const roiBefore = await page.locator('text=Promotion ROI').first().locator('..').innerText()
  const baselineCell = page.locator('[role="row"]').nth(1).locator('[role="gridcell"]').nth(4)
  await baselineCell.click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('9999')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const roiAfter = await page.locator('text=Promotion ROI').first().locator('..').innerText()
  check(roiBefore !== roiAfter, 'live P&L recalculates after a grid edit')

  // Undo must put it back.
  await page.locator('button', { hasText: 'Undo' }).first().click()
  await page.waitForTimeout(400)
  const roiUndone = await page.locator('text=Promotion ROI').first().locator('..').innerText()
  check(roiUndone === roiBefore, 'undo restores the previous value')
  await shot(page, '06-planning-grid')

  // ── Trade calendar ─────────────────────────────────────────────────────
  console.log('\nTrade calendar')
  await page.click('a[href$="/calendar"]')
  await page.waitForSelector('text=Customer', { timeout: 20000 })
  await page.waitForTimeout(600)
  const bars = await page.locator('[role="button"][title*="planned spend"]').count()
  check(bars > 0, 'calendar renders promotion bars', `${bars} bars`)
  await shot(page, '07-calendar')

  // ── Forecast ───────────────────────────────────────────────────────────
  console.log('\nForecast')
  await page.click('a[href$="/forecast"]')
  await page.waitForSelector('text=Planning group', { timeout: 20000 })
  await page.waitForTimeout(600)

  const headerCols = await page.locator('thead th').count()
  check(headerCols > 6, 'forecast grid renders period columns', `${headerCols} columns`)
  check(
    (await page.locator('thead th').nth(1).innerText()).includes('w'),
    'period headers show the week count — the reason this is fiscal, not monthly',
  )

  // A queue nobody would work is worse than no queue. Read it off the badge,
  // which carries the number as plain text rather than a CSS-uppercased label.
  const badge = await page.locator('text=/High urgency:\\s*\\d+/').first().innerText()
  const high = Number(badge.replace(/[^\d]/g, ''))
  const subtitle = await page.locator('text=/\\d+ high · \\d+ medium urgency/').first().innerText()
  const total = (subtitle.match(/\d+/g) ?? []).reduce((a, n) => a + Number(n), 0)
  check(
    high > 0 && total > 0 && total < 120,
    'recommendation queue is populated but workable',
    `${high} high of ${total} findings`,
  )

  // Expanding a leaf must reveal the three drivers behind the number.
  await page.locator('tbody button[aria-expanded]').nth(1).click()
  await page.waitForTimeout(400)
  const driverInputs = await page.locator('tbody input[type="number"]').count()
  check(driverInputs > 0, 'expanding a line reveals its drivers', `${driverInputs} editable cells`)

  const totalBefore = await page.locator('tfoot td').last().innerText()
  const driver = page.locator('tbody input[type="number"]:not([disabled])').first()
  await driver.fill('999')
  await driver.blur()
  await page.waitForTimeout(500)
  check(
    (await page.locator('tfoot td').last().innerText()) !== totalBefore,
    'editing a driver rolls up to the grand total',
  )
  await shot(page, '14-forecast')

  // The level control must genuinely re-pivot the hierarchy.
  await page.selectOption('select[aria-label="Planning level"]', 'brand_cust')
  await page.waitForTimeout(500)
  const brandRow = (await page.locator('tbody tr').first().innerText()).split('\n')[0]
  check(
    ['Summit Trail', 'Golden Hour', 'Harvest Table'].some((b) => brandRow.includes(b)),
    'grid re-pivots to brand → customer',
    brandRow,
  )
  await page.selectOption('select[aria-label="Planning level"]', 'channel_cust_group')
  await page.waitForTimeout(500)
  const channelRow = (await page.locator('tbody tr').first().innerText()).split('\n')[0]
  check(
    ['Grocery', 'Mass', 'Club', 'Natural', 'Distributor'].some((c) => channelRow.includes(c)),
    'grid re-pivots to channel → customer → group',
    channelRow,
  )
  await page.selectOption('select[aria-label="Planning level"]', 'cust_group')
  await page.waitForTimeout(400)

  // Applying a recommendation must move the forecast.
  await page.locator('button', { hasText: 'View recommendations' }).first().click()
  await page.waitForTimeout(400)
  const preApply = await page.locator('tfoot td').last().innerText()
  await page.locator('button', { hasText: 'Apply' }).first().click()
  await page.waitForTimeout(600)
  check(
    (await page.locator('tfoot td').last().innerText()) !== preApply,
    'applying a recommendation moves the forecast',
  )
  await shot(page, '16-forecast-recs')

  // ── Funds ──────────────────────────────────────────────────────────────
  console.log('\nTrade funds')
  await page.click('a[href$="/funds"]')
  await page.waitForSelector('text=Fund balances', { timeout: 20000 })
  const fundRows = await page.locator('table tbody tr').count()
  check(fundRows > 0, 'fund table renders', `${fundRows} funds`)
  await page.locator('table tbody tr').first().click()
  await page.waitForSelector('text=Ledger', { timeout: 10000 })
  check(
    await page.locator('div[role="dialog"]').first().isVisible(),
    'fund ledger drill-down opens',
  )
  await shot(page, '08-fund-ledger')
  await page.keyboard.press('Escape')

  // ── Sales analytics ────────────────────────────────────────────────────
  console.log('\nSales analytics')
  await page.click('a[href$="/sales"]')
  await page.waitForSelector('text=Net sales vs plan', { timeout: 20000 })
  await page.waitForTimeout(600)

  const netTile = await page.locator('text=Net sales').first().locator('..').innerText()
  check(/\$\d/.test(netTile), 'net sales tile shows a dollar figure', netTile.split('\n')[1])
  check(
    /of plan/.test(netTile),
    'net sales is reported against plan, not in isolation',
  )
  for (const label of ['Gross profit', 'Gross margin', 'Cases shipped', 'Case fill rate', 'DSO']) {
    check(
      await page.locator(`text=${label}`).first().isVisible(),
      `"${label}" KPI renders`,
    )
  }
  check(
    await page.locator('text=Territory leaderboard').first().isVisible(),
    'territory leaderboard renders',
  )
  check(
    await page.locator('text=Accounts needing attention').first().isVisible(),
    'accounts-needing-attention panel renders',
  )

  // ── Cross-filtering: the group chart is also the page filter ───────────
  // Clicking a product group focuses every additive widget on it. Plan is
  // customer-level, so attainment must go QUIET under the lens rather than
  // compare a product slice against a whole-account plan.
  const groupChart = page.locator('section', { hasText: 'Gross profit by product group' }).last()
  await groupChart.locator('svg text', { hasText: 'Cold Brew' }).first().click()
  await page.waitForTimeout(600)
  check(page.url().includes('group=Cold'), 'clicking a product group writes the lens into the URL')
  const focusedTile = await page.locator('text=Net sales').first().locator('..').innerText()
  check(
    !/of plan/.test(focusedTile),
    'plan attainment goes quiet under a product lens (plan has no product slice)',
  )
  check(
    await page.locator('text=rolling eight fiscal periods · Cold Brew').first().isVisible(),
    'rolling net-sales chart re-titles to the focused group',
  )
  await groupChart.locator('svg text', { hasText: 'Cold Brew' }).first().click()
  await page.waitForTimeout(600)
  check(!page.url().includes('group='), 'clicking the focused group again releases the page')
  const releasedTile = await page.locator('text=Net sales').first().locator('..').innerText()
  check(/of plan/.test(releasedTile), 'plan attainment returns once the lens clears')

  // A 4-4-5 period is not a month. The week count under every column is the
  // line that lands with a planner, so its absence is a real regression.
  // textContent, not innerText — SVGElement has no innerText, so allInnerTexts()
  // silently returns a list of empty strings and the check passes on nothing.
  const columnAxis = await page.locator('svg text').allTextContents()
  check(
    columnAxis.some((t) => /^\d+w$/.test(t) || /of \d+w$/.test(t)),
    'period columns print their week count',
    columnAxis.filter((t) => /w$/.test(t)).slice(0, 4).join(' '),
  )

  // Scope control must actually re-scope, not just re-label.
  const beforeScope = await page.locator('text=Net sales').first().locator('..').innerText()
  await page.locator('button', { hasText: /^Fiscal YTD$/ }).first().click()
  await page.waitForTimeout(500)
  const afterScope = await page.locator('text=Net sales').first().locator('..').innerText()
  check(beforeScope !== afterScope, 'changing the scope re-scopes every figure',
    `${beforeScope.split('\n')[1]} → ${afterScope.split('\n')[1]}`)
  await shot(page, '17-sales-analytics')

  await page.locator('button', { hasText: /^Quarter to date$/ }).first().click()
  await page.waitForTimeout(400)

  // ── Analytics ──────────────────────────────────────────────────────────
  console.log('\nAnalytics')
  await page.click('a[href$="/analytics"]')
  await page.waitForSelector('text=Gross-to-net waterfall', { timeout: 20000 })
  await page.waitForTimeout(500)
  check(
    await page.locator('text=Quality of lift').first().isVisible(),
    'honest-analytics panel renders',
  )
  check(
    await page.locator('text=Promotion effectiveness').first().isVisible(),
    'effectiveness leaderboard renders',
  )
  const svgCount = await page.locator('svg').count()
  check(svgCount > 4, 'charts rendered as SVG', `${svgCount} svg nodes`)
  await shot(page, '09-analytics')

  // Table view is the relief for light-mode contrast — it must exist and work.
  const tableToggle = page.locator('button[aria-label="Show as table"]').first()
  await tableToggle.click()
  await page.waitForTimeout(250)
  check(
    await page.locator('button[aria-label="Show as chart"]').first().isVisible(),
    'every chart offers a table view',
  )
  await tableToggle.click().catch(() => {})

  // ── Settings: retune the engine live ───────────────────────────────────
  console.log('\nSettings')
  await page.click('a[href$="/settings"]')
  await page.waitForSelector('text=Deduction matching', { timeout: 20000 })
  const autoBefore = await page
    .locator('text=Auto-matched').last().locator('..').locator('p').nth(1).innerText()
  const slider = page.locator('input[aria-label="Amount tolerance"]')
  await slider.fill('0.02')
  await page.waitForTimeout(600)
  const autoAfter = await page
    .locator('text=Auto-matched').last().locator('..').locator('p').nth(1).innerText()
  check(
    autoBefore !== autoAfter,
    'tightening amount tolerance re-scores every deduction live',
    `${autoBefore} → ${autoAfter}`,
  )
  await shot(page, '10-settings')

  // ── Command palette ────────────────────────────────────────────────────
  console.log('\nShell')
  await page.keyboard.press('Control+k')
  await page.waitForSelector('input[placeholder*="Search promotions"]', { timeout: 5000 })
  await page.keyboard.type('Kroger')
  await page.waitForTimeout(350)
  const paletteHits = await page.locator('div[role="dialog"] li').count()
  check(paletteHits > 0, 'command palette searches the dataset', `${paletteHits} results`)
  await shot(page, '11-command-palette')
  await page.keyboard.press('Escape')

  // ── Sidebar collapse ───────────────────────────────────────────────────
  // Presenting on a shared screen means reclaiming the rail. Navigation has to
  // survive the collapse, and the state has to persist a reload — a presenter
  // who has to re-collapse it on every page is worse off than before.
  const asideWidth = () => page.locator('aside').first().evaluate((el) => el.clientWidth)
  const expandedWidth = await asideWidth()
  await page.click('button[aria-label="Collapse sidebar"]')
  await page.waitForTimeout(350)
  const collapsedWidth = await asideWidth()
  check(
    collapsedWidth < expandedWidth && collapsedWidth > 0,
    'sidebar collapses to an icon rail',
    `${expandedWidth}px → ${collapsedWidth}px`,
  )
  check(
    await page.locator('aside a[href$="/deductions"]').first().isVisible(),
    'navigation survives the collapse',
  )
  await shot(page, '18-sidebar-collapsed')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  check(
    (await asideWidth()) === collapsedWidth,
    'collapsed state survives a reload',
  )

  // Ctrl+\ is the keyboard route back.
  await page.keyboard.press('Control+\\')
  await page.waitForTimeout(350)
  check(
    (await asideWidth()) === expandedWidth,
    'Ctrl+\\ toggles the sidebar back open',
  )

  // ── Dark mode ──────────────────────────────────────────────────────────
  await page.click('button[aria-label="Switch to dark mode"]')
  await page.waitForTimeout(400)
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  check(theme === 'dark', 'dark mode applies')
  await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await shot(page, '12-analytics-dark')
  await page.goto(`${BASE}/sales`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await shot(page, '19-sales-dark')
  await page.goto(`${BASE}/deductions`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await shot(page, '13-deductions-dark')

  // ── Console health ─────────────────────────────────────────────────────
  // Snapshot BEFORE the deliberate bad-URL probe below. On GitHub Pages an
  // unknown path genuinely returns HTTP 404 (served from 404.html), which the
  // browser logs as a console error — asserting zero errors after that point
  // would fail on a correctly working deploy.
  check(consoleErrors.length === 0, 'no console errors during the run',
    consoleErrors.slice(0, 3).join(' | '))

  // ── Deep link + 404 ────────────────────────────────────────────────────
  await page.goto(`${BASE}/nope`, { waitUntil: 'networkidle' })
  check(
    await page.locator("text=That page doesn’t exist").first().isVisible(),
    'unknown route shows a designed 404',
  )

  // ── Subpath deploy: static routes must be real 200s ────────────────────
  // GitHub Pages has no rewrite rules. Without pre-rendered route directories
  // these paths are served from 404.html — the app renders, but the status
  // line says 404, which breaks link unfurling in Outlook and Teams. Only
  // meaningful against a deployed origin; dev/preview always answer 200.
  if (!BASE.includes('localhost')) {
    console.log('\nDeployed routing')
    for (const route of ['deductions', 'promotions', 'forecast', 'sales', 'analytics', 'funds']) {
      const res = await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' })
      check(res?.status() === 200, `/${route} returns HTTP 200`, `got ${res?.status()}`)
    }
  }

  await browser.close()

  console.log(`\n${results.length - failures}/${results.length} checks passed`)
  console.log(`Screenshots in ./${SHOTS}/`)
  if (failures > 0) {
    console.log('\nFailures:')
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name} ${r.detail}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\nverify.mjs crashed:', err)
  process.exit(1)
})
