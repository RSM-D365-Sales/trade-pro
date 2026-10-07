/**
 * Records the Trade Promotion Management booth video with Playwright.
 *
 *   node demo-kit/record.mjs                       # tour + interstitial + reel
 *   node demo-kit/record.mjs --only tour           # just the app tour
 *   node demo-kit/record.mjs --only interstitial   # just the title card
 *   node demo-kit/record.mjs --only reel           # join title card + tour (needs both MP4s)
 *   node demo-kit/record.mjs --only frames         # pull check frames from the finished MP4s
 *   node demo-kit/record.mjs --base http://127.0.0.1:5188 --no-captions
 *
 * The app must be running at --base (default http://127.0.0.1:5188) as a
 * production build anchored to scenes.mjs AS_OF — see demo-kit/README.md.
 *
 * Output (demo-kit/out/):
 *   trade-promotion-management-tour.webm / .mp4   the tour (sum of scenes.mjs seconds), 1920×1080
 *   interstitial.webm / .mp4                      the 12 s title card between clips
 *   trade-promotion-management-reel.mp4           title card + tour, ffmpeg concat (stream copy)
 *   tour-timings.json                             measured scene boundaries (for VO alignment)
 *   frames/*.png                                  check frames (--only frames)
 *
 * MP4 (H.264) needs an ffmpeg with libx264. The script looks for, in order:
 * $FFMPEG, `ffmpeg` on PATH, the one bundled with Python's imageio-ffmpeg.
 * Playwright's own ffmpeg is VP8/WebM-only, so without one of those you get WebM.
 *
 * Recorded in the LIGHT theme: the context asks for a light colour scheme and
 * an init script pins localStorage 'bstpm.theme' to 'light' before first paint,
 * so a dark-mode choice left in the profile can't leak into the video.
 *
 * Nothing here mutates data, not even the in-memory store: the tour navigates,
 * switches filter segments, opens and closes side panels (deduction evidence,
 * fund ledger), toggles the forecast recommendation list open, and hovers. It
 * never clicks Accept / Reject / Open dispute / Resolve, Submit / Approve /
 * Clone, Apply / Dismiss, Bulk update, Reset demo, never types into the
 * planning grid, never drags a calendar bar, and never opens Settings.
 */
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { SCENES, VIDEO, TOTAL_SECONDS, AS_OF } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const BASE = (args.base ?? 'http://127.0.0.1:5188').replace(/\/$/, '')
const OUT = resolve(args.out ?? join(here, 'out'))
const CAPTIONS = !args['no-captions']
const ONLY = args.only ?? 'all'
const { width: W, height: H } = VIDEO.frame
const SLUG = 'trade-promotion-management'
const TOUR_MP4 = join(OUT, `${SLUG}-tour.mp4`)
const CARD_MP4 = join(OUT, 'interstitial.mp4')
const REEL_MP4 = join(OUT, `${SLUG}-reel.mp4`)

mkdirSync(OUT, { recursive: true })

const rsmWhite = 'data:image/png;base64,' + readFileSync(join(here, 'assets', 'rsm-logo-white.png')).toString('base64')

// ---------------------------------------------------------------------------
// Overlay injected into the app: a visible cursor, the lower-third caption and
// the closing card. Everything lives under window.__demo so scenes can call it.
// The app's chrome is a 48 px top ribbon, so the caption sits bottom-left.
// ---------------------------------------------------------------------------
const OVERLAY = String.raw`
(() => {
  if (window.__demo) return;
  const css = document.createElement('style');
  css.textContent = ${JSON.stringify(`
    #__demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:${2147483600};pointer-events:none;
      transform:translate(-9999px,-9999px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));will-change:transform}
    .__demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:${2147483500};
      pointer-events:none;border:3px solid #009CDE;opacity:.9;animation:__demo-rip .55s ease-out forwards}
    @keyframes __demo-rip{from{transform:scale(.25);opacity:.9}to{transform:scale(1.15);opacity:0}}
    #__demo-caption{position:fixed;left:48px;bottom:40px;z-index:${2147483400};display:flex;align-items:stretch;
      opacity:0;transform:translateY(14px);transition:opacity .35s ease,transform .35s ease;pointer-events:none;
      font-family:'Segoe UI',system-ui,sans-serif;max-width:960px}
    #__demo-caption.on{opacity:1;transform:translateY(0)}
    #__demo-caption .bar{width:6px;background:#009CDE;border-radius:3px 0 0 3px;flex:none}
    #__demo-caption .box{background:rgba(0,21,61,.94);color:#fff;padding:12px 22px 13px 18px;border-radius:0 8px 8px 0;
      box-shadow:0 12px 32px rgba(0,21,61,.35)}
    #__demo-caption .t{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:22px;line-height:1.2;letter-spacing:-.005em}
    #__demo-caption .s{font-size:14.5px;color:#C9D1DB;margin-top:3px;line-height:1.35}
    #__demo-end{position:fixed;inset:0;z-index:${2147483450};background:#00153D;color:#fff;opacity:0;transition:opacity .5s ease;
      font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center}
    #__demo-end.on{opacity:1}
    #__demo-end .inner{display:flex;flex-direction:column;align-items:center;gap:18px;transform:translateY(-20px);max-width:1500px;text-align:center;padding:0 60px}
    #__demo-end .wm{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:58px;letter-spacing:-.01em;line-height:1;display:flex;align-items:center;gap:16px}
    #__demo-end .wm .stem{color:#3F9C35}
    #__demo-end .title{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:92px;letter-spacing:-.015em;line-height:1.05;margin-top:12px}
    #__demo-end .tag{font-family:Poppins,'Segoe UI',sans-serif;font-weight:500;font-size:34px;color:#009CDE;margin-top:4px;line-height:1.25;text-wrap:balance}
    #__demo-end .campus{font-size:17px;color:#9FB0CC;letter-spacing:.08em;text-transform:uppercase;margin-top:26px}
    #__demo-end .rsm{position:absolute;right:72px;bottom:56px;display:flex;align-items:center;gap:12px;color:#C9D1DB;font-size:15px}
    #__demo-end .rsm img{height:30px;width:auto;display:block}
    #__demo-end .inner > *{opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease}
    #__demo-end.on .inner > *{opacity:1;transform:none}
    #__demo-end.on .inner > :nth-child(2){transition-delay:.15s}
    #__demo-end.on .inner > :nth-child(3){transition-delay:.3s}
    #__demo-end.on .inner > :nth-child(4){transition-delay:.45s}
    #__demo-end.on .rsm{transition-delay:.6s}
  `)};
  const mark = (size) => '<svg viewBox="40 30 200 220" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<path d="M62 232 Q75 150 150 130" stroke="#009CDE" stroke-width="26" stroke-linecap="round" fill="none"/>' +
    '<g transform="translate(155 108) rotate(-45)"><path d="M-72 0 C-40 -50 40 -50 72 0 C40 50 -40 50 -72 0 Z" fill="#3F9C35"/>' +
    '<path d="M-45 0 L45 0" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/></g></svg>';
  const mount = () => {
    document.head.appendChild(css);
    const cur = document.createElement('div');
    cur.id = '__demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M4 2.5 L4 22.5 L9.3 17.6 L13 26 L16.6 24.4 L12.9 16.2 L20.5 16.2 Z" fill="#fff" stroke="#00153D" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = '__demo-caption';
    cap.innerHTML = '<div class="bar"></div><div class="box"><div class="t"></div><div class="s"></div></div>';
    document.body.appendChild(cap);
    window.addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.__demo = {
    caption(title, sub) {
      const el = document.getElementById('__demo-caption'); if (!el) return;
      const swap = () => { el.querySelector('.t').textContent = title; el.querySelector('.s').textContent = sub || ''; el.classList.add('on'); };
      if (el.classList.contains('on')) { el.classList.remove('on'); setTimeout(swap, 260); } else swap();
    },
    hideCaption() { const el = document.getElementById('__demo-caption'); if (el) el.classList.remove('on'); },
    hideCursor() { const el = document.getElementById('__demo-cursor'); if (el) el.style.display = 'none'; },
    endCard(opts) {
      const el = document.createElement('div'); el.id = '__demo-end';
      el.innerHTML = '<div class="inner">' +
        '<div class="wm">' + mark(66) + '<span>blue<span class="stem">stem</span></span></div>' +
        '<div class="title">' + opts.title + '</div>' +
        '<div class="tag">' + opts.tagline + '</div>' +
        '<div class="campus">' + opts.campus + '</div>' +
        '</div><div class="rsm"><span>Powered by</span><img alt="RSM" src="' + opts.rsm + '"></div>';
      document.body.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    },
  };
})();`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function moveTo(page, locator, steps = 18) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('moveTo: element not visible: ' + locator)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
}

async function click(page, locator, { settle = 250 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator)
  await sleep(140)
  await page.mouse.down()
  await sleep(70)
  await page.mouse.up()
  await sleep(settle)
}

async function hover(page, locator, steps = 30) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator, steps)
}

/** Smooth-ish wheel scroll in small steps so the recording shows motion. */
async function wheel(page, dy, steps = 14) {
  const step = dy / steps
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, step)
    await sleep(28)
  }
}

async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await sleep(450)
}

// The sidebar is a plain <aside> of NavLinks. Deductions carries a queue-count
// badge in its accessible name ("Deductions 148"), so match on the label start.
const nav = (page, name) => page.locator('aside nav').getByRole('link', { name: new RegExp('^' + name) })

/** The page's own <h1> (PageHeader), as opposed to drawer or card headings. */
const h1 = (page, name) => page.locator('main h1', { hasText: name })

/** Navigate via the sidebar and wait for the page's content to paint. */
async function goTo(page, linkName, ready) {
  await click(page, nav(page, linkName), { settle: 100 })
  await ready.waitFor({ timeout: 20000 })
  await sleep(300)
}

/** A filter segment ("Likely invalid 33", "Live 4"): a pressed-state button in the page header. */
const segment = (page, label) => page.locator('main button[aria-pressed]', { hasText: new RegExp('^' + label + '\\s*\\d') })

/** Body rows of the page's main table (not one inside a drawer). */
const mainRows = (page) => page.locator('main table tbody tr')

/** Close whichever side panel is open, via its own ✕ (never Escape-and-hope). */
async function closeDrawer(page) {
  const dialog = page.getByRole('dialog')
  await click(page, dialog.getByRole('button', { name: 'Close' }), { settle: 250 })
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
}

async function caption(page, scene, step) {
  if (!CAPTIONS) return
  const c = step ?? scene
  await page.evaluate(([t, s]) => window.__demo?.caption(t, s), [c.caption, c.sub])
}

// ---------------------------------------------------------------------------
// Scene choreography. Each must finish inside its scenes.mjs budget; the runner
// pads to the budget so the cut lands on the scripted timecode.
// ---------------------------------------------------------------------------
const actions = {
  async dashboard(page) {
    await page.mouse.move(W * 0.45, H * 0.3, { steps: 20 })
    await sleep(900)
    // the four KPI tiles, money at risk first
    await hover(page, page.getByText('Deductions at risk', { exact: false }).first(), 22)
    await sleep(1500)
    await hover(page, page.getByText('Recovered to date', { exact: false }).first(), 18)
    await sleep(900)
    await hover(page, page.getByRole('heading', { name: 'Deduction queue' }), 20)
    await sleep(700)
  },

  async deductions(page) {
    // the dashboard's own call to action leads into the queue
    await click(page, page.getByRole('button', { name: 'Work the deduction queue' }), { settle: 100 })
    await h1(page, 'Deductions').waitFor({ timeout: 20000 })
    await mainRows(page).first().waitFor({ timeout: 20000 })
    await sleep(500)
    await hover(page, page.getByText('Total deducted', { exact: false }).first(), 18)
    await sleep(1100)
    await hover(page, page.getByText('Likely invalid or unmatched', { exact: false }).first(), 16)
    await sleep(900)
    await click(page, segment(page, 'Likely invalid'), { settle: 300 })
    await mainRows(page).first().waitFor({ timeout: 10000 })
    await hover(page, mainRows(page).first(), 18)
    await sleep(500)
    await hover(page, mainRows(page).nth(3), 14)
  },

  async evidence(page) {
    await click(page, mainRows(page).first(), { settle: 200 })
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 10000 })
    await sleep(1300)
    await hover(page, dialog.getByText('Candidate promotions'), 18)
    await sleep(900)
    // let the candidate's score breakdown and warnings come into view
    await page.mouse.move(W - 420, H * 0.62, { steps: 14 })
    await wheel(page, 300, 12)
    await sleep(2200)
    await closeDrawer(page)
  },

  async planning(page) {
    await goTo(page, 'Promotions', mainRows(page).first())
    await click(page, segment(page, 'Live'), { settle: 300 })
    await mainRows(page).first().waitFor({ timeout: 10000 })
    await sleep(300)
    // Open the live event with the best planned ROI (PRM-NWF-26088, +38%, at
    // AS_OF): the grid is the point of the scene, not a margin-destroying event.
    const texts = await mainRows(page).allInnerTexts()
    const roi = (t) => Number((/(-?\d+)%\s*planned/.exec(t.replace(/\s+/g, ' ')) ?? [])[1] ?? -Infinity)
    const best = texts.reduce((bi, t, i) => (roi(t) > roi(texts[bi]) ? i : bi), 0)
    await click(page, mainRows(page).nth(best), { settle: 100 })
    const pnl = page.locator('main h2', { hasText: 'Live P&L' })
    await pnl.waitFor({ timeout: 20000 })
    await sleep(1000)
    // walk the grid (role="grid" divs, not a table), then rest on the P&L.
    // Hover only: a click selects a cell and typing would edit the plan.
    const gridRows = page.locator('main [role="grid"] [role="row"]:has([role="gridcell"])')
    await hover(page, gridRows.first(), 18)
    await sleep(500)
    await hover(page, gridRows.nth(3), 14)
    await sleep(500)
    await hover(page, pnl, 22)
    await sleep(800)
  },

  async calendar(page) {
    await goTo(page, 'Trade calendar', h1(page, 'Trade calendar'))
    const conflicted = page.locator('main [title*="SKU conflict"]').first()
    await conflicted.waitFor({ timeout: 15000 })
    await sleep(700)
    await page.mouse.move(W * 0.55, H * 0.45, { steps: 18 })
    await sleep(700)
    await hover(page, conflicted, 22)
    await sleep(1400)
    await hover(page, page.locator('main [title*="SKU conflict"]').nth(3), 18)
  },

  async forecast(page) {
    await goTo(page, 'Forecast', page.getByRole('button', { name: 'View recommendations' }))
    await sleep(900)
    await hover(page, page.getByText('Needs attention', { exact: false }).first(), 20)
    await sleep(1000)
    // opens the list only — never Apply or Dismiss
    await click(page, page.getByRole('button', { name: 'View recommendations' }), { settle: 300 })
    await page.getByRole('button', { name: 'Hide recommendations' }).waitFor({ timeout: 5000 })
    await page.mouse.move(W - 200, H * 0.62, { steps: 18 })
    await sleep(900)
  },

  async funds(page) {
    await goTo(page, 'Trade funds', mainRows(page).first())
    await sleep(300)
    await hover(page, page.getByText('Remaining', { exact: true }).first(), 16)
    await sleep(600)
    const over = mainRows(page).filter({ hasText: 'Over-committed' }).first()
    await click(page, over, { settle: 200 })
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 10000 })
    await sleep(1000)
    await hover(page, dialog.getByText('Ledger', { exact: true }), 16)
    await sleep(700)
    await closeDrawer(page)
  },

  async analytics(page) {
    await goTo(page, 'Sales analytics', h1(page, 'Sales analytics'))
    await page.mouse.move(W * 0.4, H * 0.55, { steps: 16 })
    await sleep(1700)
    await goTo(page, 'Trade analytics', page.getByText('Gross-to-net waterfall'))
    await sleep(500)
    await hover(page, page.getByText('Gross-to-net waterfall'), 18)
    await sleep(700)
    await page.mouse.move(W * 0.3, H * 0.6, { steps: 22 })
  },

  async 'end-card'(page) {
    await page.evaluate(() => { window.__demo?.hideCaption(); window.__demo?.hideCursor() })
    await sleep(250)
    await page.evaluate(
      (o) => window.__demo?.endCard(o),
      { title: VIDEO.title, tagline: VIDEO.tagline, campus: VIDEO.campus, rsm: rsmWhite },
    )
  },
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
async function recordTour(browser) {
  console.log(`\nRecording tour from ${BASE} (${TOTAL_SECONDS}s, captions ${CAPTIONS ? 'on' : 'off'})`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/Detroit',
  })
  // Light theme and an expanded sidebar, whatever a previous session persisted.
  await context.addInitScript(() => {
    try { localStorage.setItem('bstpm.theme', 'light'); localStorage.setItem('bstpm.sidebar', 'expanded') } catch {}
  })
  await context.addInitScript(OVERLAY)
  const videoStart = Date.now()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.locator('main h1').first().waitFor({ timeout: 30000 })
  await page.getByText('Deductions at risk', { exact: false }).first().waitFor({ timeout: 30000 })
  // Don't record a build anchored to some other day: the VO quotes AS_OF figures.
  const anchored = await page.getByText(`to ${AS_OF}`, { exact: false }).count()
  if (!anchored) console.log(`  ! the app is not anchored to ${AS_OF} — rebuild with VITE_DEMO_TODAY=${AS_OF} (README)`)
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  if (theme !== 'light') throw new Error(`theme is ${theme}, expected light`)
  await page.evaluate(() => document.fonts.ready)
  await sleep(600)
  await page.mouse.move(W * 0.5, H * 0.5)

  const t0 = Date.now()
  const timings = []
  for (const scene of SCENES) {
    const start = Date.now()
    process.stdout.write(`  ${scene.caption.padEnd(30)} ${String(scene.seconds).padStart(4)}s … `)
    await caption(page, scene)
    try {
      await actions[scene.id](page, scene)
    } catch (e) {
      console.log(`\n  ! ${scene.id}: ${e.message.split('\n')[0]}`)
    }
    const used = (Date.now() - start) / 1000
    const pad = scene.seconds * 1000 - (Date.now() - start)
    if (pad < 0) console.log(`ran long by ${(-pad / 1000).toFixed(1)}s`)
    else { await sleep(pad); console.log(`ok (${used.toFixed(1)}s of action)`) }
    timings.push({ id: scene.id, caption: scene.caption, start: +((start - t0) / 1000).toFixed(2), end: +((Date.now() - t0) / 1000).toFixed(2) })
  }

  const video = page.video()
  const wallEnd = Date.now()
  await context.close()
  const raw = await video.path()
  const webm = join(OUT, `${SLUG}-tour.webm`)
  if (existsSync(webm)) unlinkSync(webm)
  renameSync(raw, webm)

  const leadIn = (t0 - videoStart) / 1000
  const duration = timings.at(-1).end
  const span = (wallEnd - t0) / 1000
  writeFileSync(join(OUT, 'tour-timings.json'), JSON.stringify({ base: BASE, leadInSeconds: +leadIn.toFixed(2), durationSeconds: duration, wallSpanSeconds: +span.toFixed(2), scenes: timings }, null, 2))
  if (errors.length) console.log('  page errors:', errors)
  console.log(`  → ${webm}`)
  toMp4(webm, TOUR_MP4, leadIn, duration, span)
}

async function recordInterstitial(browser) {
  const secs = VIDEO.interstitialSeconds
  console.log(`\nRecording interstitial (${secs}s)`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })
  const videoStart = Date.now()
  const page = await context.newPage()
  const q = new URLSearchParams({
    dur: String(secs), manual: '1',
    next: VIDEO.title, tag: VIDEO.tagline,
    eyebrow: `${VIDEO.company} · ${VIDEO.campus}`,
    nodes: JSON.stringify(VIDEO.interstitialNodes),
    erp: VIDEO.interstitialErp, link: VIDEO.interstitialLink,
  })
  const url = pathToFileURL(join(here, 'interstitial.html')).href + '?' + q.toString()
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  const t0 = Date.now()
  await page.evaluate(() => window.__startTimeline())
  // Hold the finished card 1.5 s past the bar: Playwright's WebM loses the
  // last half-second or so at context close, which left the card at 11.6 s.
  await sleep(secs * 1000 + 1500)
  const video = page.video()
  const wallEnd = Date.now()
  await context.close()
  const webm = join(OUT, 'interstitial.webm')
  if (existsSync(webm)) unlinkSync(webm)
  renameSync(await video.path(), webm)
  console.log(`  → ${webm}`)
  toMp4(webm, CARD_MP4, (t0 - videoStart) / 1000, secs, (wallEnd - t0) / 1000)
}

// ---------------------------------------------------------------------------
// Reel: title card + tour as one MP4. Both inputs come out of toMp4 with the
// same codec settings, so the concat demuxer can stream-copy (no re-encode).
// ---------------------------------------------------------------------------
function buildReel() {
  console.log('\nBuilding reel')
  for (const f of [CARD_MP4, TOUR_MP4]) {
    if (!existsSync(f)) { console.log(`  missing ${f} — record it first`); return }
  }
  const ff = findFfmpeg()
  if (!ff) { console.log('  (no ffmpeg found — cannot join)'); return }
  const list = join(OUT, 'reel-list.txt')
  // concat demuxer wants forward slashes and single quotes
  writeFileSync(list, [CARD_MP4, TOUR_MP4].map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', REEL_MP4],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) { console.log('  ffmpeg concat failed with status', r.status); return }
  console.log(`  → ${REEL_MP4}  (${probeSeconds(ff, CARD_MP4).toFixed(1)}s + ${probeSeconds(ff, TOUR_MP4).toFixed(1)}s = ${probeSeconds(ff, REEL_MP4).toFixed(1)}s)`)
}

/** Pull PNG frames: either side of the reel's join, plus the midpoint of every tour scene. */
function pullFrames() {
  const ff = findFfmpeg()
  if (!ff) { console.log('no ffmpeg found'); return }
  const dir = join(OUT, 'frames')
  mkdirSync(dir, { recursive: true })
  const grab = (src, t, name) => {
    const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', src, '-frames:v', '1', join(dir, name)], { encoding: 'utf8' })
    console.log(r.status === 0 ? `  → frames/${name} (${t.toFixed(2)}s)` : `  ! ${name}: ffmpeg status ${r.status}`)
  }
  console.log('\nPulling check frames')
  if (existsSync(REEL_MP4)) {
    const join_ = VIDEO.interstitialSeconds
    grab(REEL_MP4, join_ - 0.5, 'reel-before-join.png')
    grab(REEL_MP4, join_ + 0.5, 'reel-after-join.png')
    grab(REEL_MP4, 6, 'reel-title-card.png')
  }
  if (existsSync(TOUR_MP4)) {
    let t = 0
    SCENES.forEach((s, i) => {
      grab(TOUR_MP4, t + s.seconds * 0.6, `tour-${String(i + 1).padStart(2, '0')}-${s.id}.png`)
      t += s.seconds
    })
    grab(TOUR_MP4, Math.max(0, TOTAL_SECONDS - 0.3), 'tour-last.png')
  }
}

// ---------------------------------------------------------------------------
// MP4 conversion
// ---------------------------------------------------------------------------
function findFfmpeg() {
  const candidates = []
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG)
  candidates.push('ffmpeg')
  try {
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
    if (py.status === 0 && py.stdout.trim()) candidates.push(py.stdout.trim())
  } catch { /* no python */ }
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /libx264/.test(r.stdout)) return c
  }
  return null
}

function probeSeconds(ff, file) {
  // ffmpeg -i prints "Duration: 00:01:02.50" to stderr; good enough without ffprobe
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || '')
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN
}

/**
 * Trim the WebM to [leadIn, leadIn + duration] and encode H.264.
 *
 * Playwright's WebM only starts at the page's first paint, so wall-clock lead-in
 * over-trims by however long the blank page took to render (2–3 s here) and
 * every cut lands early. The end of the recording is reliable, so when `span`
 * (wall-clock seconds from the scene clock's t0 to just before context.close)
 * is given, the lead-in is re-derived from the end: webmDuration − span.
 */
function toMp4(webm, mp4, leadIn, duration, span) {
  const ff = findFfmpeg()
  if (!ff) {
    console.log('  (no H.264 ffmpeg found — keeping WebM. Install imageio-ffmpeg via pip, or set $FFMPEG.)')
    return
  }
  if (span) {
    const webmSeconds = probeSeconds(ff, webm)
    if (Number.isFinite(webmSeconds)) {
      const fromEnd = Math.max(0, webmSeconds - span)
      console.log(`  lead-in: wall-clock ${leadIn.toFixed(2)}s, webm ${webmSeconds.toFixed(2)}s long for a ${span.toFixed(2)}s span → trimming ${fromEnd.toFixed(2)}s`)
      leadIn = fromEnd
    }
  }
  const argv = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', leadIn.toFixed(3), '-i', webm, '-t', duration.toFixed(3),
    '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-movflags', '+faststart', '-an', mp4,
  ]
  const r = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status === 0) console.log(`  → ${mp4}  (trimmed ${leadIn.toFixed(2)}s lead-in, ${duration}s)`)
  else console.log('  ffmpeg failed with status', r.status)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1]
    if (v && !v.startsWith('--')) { out[k] = v; i++ } else out[k] = true
  }
  return out
}

// ---------------------------------------------------------------------------
if (ONLY === 'frames') {
  pullFrames()
} else if (ONLY === 'reel') {
  buildReel()
} else {
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    if (ONLY === 'all' || ONLY === 'tour') await recordTour(browser)
    if (ONLY === 'all' || ONLY === 'interstitial') await recordInterstitial(browser)
  } finally {
    await browser.close()
  }
  if (ONLY === 'all') buildReel()
}
console.log('\nDone.')
