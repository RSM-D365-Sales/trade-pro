/**
 * Quick page screenshots for checking the app before recording.
 *   node demo-kit/shot.mjs [--base http://127.0.0.1:5188]
 * Writes demo-kit/out/check-*.png (1920×1080, same viewport and light theme as
 * the recording).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://127.0.0.1:5188').replace(/\/$/, '')
const OUT = join(here, 'out')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })
// Light theme regardless of what a previous session left in localStorage.
await context.addInitScript(() => { try { localStorage.setItem('bstpm.theme', 'light') } catch {} })
const page = await context.newPage()
const shots = [
  ['dashboard', '/'],
  ['deductions', '/deductions'],
  ['promotions', '/promotions'],
  ['calendar', '/calendar'],
  ['forecast', '/forecast'],
  ['funds', '/funds'],
  ['sales', '/sales'],
  ['analytics', '/analytics'],
  ['settings', '/settings'],
]
for (const [name, path] of shots) {
  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.locator('main h1').first().waitFor({ timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)
  const file = join(OUT, `check-${name}.png`)
  await page.screenshot({ path: file })
  console.log('→', file)
}
await browser.close()
