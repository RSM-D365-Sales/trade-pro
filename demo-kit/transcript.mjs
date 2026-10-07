/**
 * Burns the voice-over transcript into the tour, for show floors where the
 * reel plays muted. Writes new files; the captioned tour and reel are untouched.
 *
 *   node demo-kit/transcript.mjs
 *
 * Needs demo-kit/out/trade-promotion-management-tour.mp4, tour-timings.json and
 * interstitial.mp4 (from record.mjs), and an ffmpeg with libx264 (same lookup
 * as record.mjs).
 *
 * Output (demo-kit/out/):
 *   trade-promotion-management-tour-transcript.mp4   tour with the VO lines burned in
 *   trade-promotion-management-reel-transcript.mp4   title card + that tour
 *   trade-promotion-management-transcript.srt        the same lines as a sidecar file
 *   frames/transcript-*.png                          one check frame per line
 *
 * How: each scene's `vo` from scenes.mjs is rendered once by Playwright as a
 * transparent 1920×1080 PNG (Segoe UI on a Midnight panel, matching the
 * lower-third), then ffmpeg overlays each PNG over its scene's measured window.
 * The box sits bottom-right, beside the scene caption, so the two never
 * collide. The end card gets no line: it already shows the title and hook.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENES, VIDEO } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const SLUG = 'trade-promotion-management'
const TOUR = join(OUT, `${SLUG}-tour.mp4`)
const CARD = join(OUT, 'interstitial.mp4')
const TOUR_T = join(OUT, `${SLUG}-tour-transcript.mp4`)
const REEL_T = join(OUT, `${SLUG}-reel-transcript.mp4`)
const SRT = join(OUT, `${SLUG}-transcript.srt`)
const PNG_DIR = join(OUT, 'transcript')
const { width: W, height: H } = VIDEO.frame
// Lines appear just after the cut and clear just before the next one.
const IN_PAD = 0.25, OUT_PAD = 0.2

for (const f of [TOUR, CARD, join(OUT, 'tour-timings.json')]) {
  if (!existsSync(f)) { console.error(`missing ${f} — run node demo-kit/record.mjs first`); process.exit(1) }
}
const ff = findFfmpeg()
if (!ff) { console.error('No H.264 ffmpeg found (set $FFMPEG or pip install imageio-ffmpeg).'); process.exit(1) }
mkdirSync(PNG_DIR, { recursive: true })

// The VO is written to be spoken ("P and L", "fourteen million"); on screen a
// reader takes in figures faster as digits. Same words otherwise.
const WRITTEN = [
  [/\bP and L\b/g, 'P&L'],
  [/\bfourteen million\b/g, '$14.4M'],
  [/\ba hundred and eighteen\b/g, '118'],
  [/\bTwo point three million\b/g, '$2.3M'],
]
const written = (t) => WRITTEN.reduce((s, [re, to]) => s.replace(re, to), t)

const timings = JSON.parse(readFileSync(join(OUT, 'tour-timings.json'), 'utf8')).scenes
const lines = SCENES.filter((s) => s.id !== 'end-card').map((s) => {
  const t = timings.find((x) => x.id === s.id)
  if (!t) throw new Error(`no timing for scene ${s.id}`)
  return { id: s.id, text: written(s.vo), start: t.start + IN_PAD, end: t.end - OUT_PAD, png: join(PNG_DIR, `${s.id}.png`) }
})

// 1. render one transparent PNG per line -------------------------------------
const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><html><head><style>
  html,body{margin:0;background:transparent}
  body{position:relative;width:${W}px;height:${H}px}
  #t{position:absolute;left:600px;right:48px;bottom:40px;display:flex;justify-content:center}
  #t div{background:rgba(0,21,61,.9);color:#fff;font:600 30px/1.3 'Segoe UI',system-ui,sans-serif;
    padding:14px 26px 16px;border-radius:8px;text-align:center;text-wrap:balance;max-width:100%;
    box-shadow:0 12px 32px rgba(0,21,61,.35)}
</style></head><body><div id="t"><div></div></div></body></html>`)
for (const l of lines) {
  await page.evaluate((txt) => { document.querySelector('#t div').textContent = txt }, l.text)
  await page.screenshot({ path: l.png, omitBackground: true })
}
await browser.close()

// 2. overlay each PNG over its window, same encode settings as record.mjs ----
// (identical codec parameters are what let the reel join by stream copy)
const enc = ['-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']
const chain = lines.map((l, i) =>
  `${i === 0 ? '[0:v]' : `[v${i}]`}[${i + 1}:v]overlay=0:0:enable='between(t,${l.start.toFixed(2)},${l.end.toFixed(2)})'[v${i + 1}]`,
).join(';')
run([ '-i', TOUR, ...lines.flatMap((l) => ['-i', l.png]), '-filter_complex', chain, '-map', `[v${lines.length}]`, ...enc, TOUR_T ])
console.log(`→ ${TOUR_T}  (${probeSeconds(TOUR_T).toFixed(1)}s)`)

// 3. reel: title card + transcript tour, concat by stream copy ---------------
const list = join(OUT, 'reel-transcript-list.txt')
writeFileSync(list, [CARD, TOUR_T].map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n')
run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', REEL_T])
console.log(`→ ${REEL_T}  (${probeSeconds(REEL_T).toFixed(1)}s)`)

// 4. sidecar SRT (tour timeline) -----------------------------------------------
const ts = (s) => {
  const ms = Math.round(s * 1000)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
writeFileSync(SRT, lines.map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end)}\n${l.text}\n`).join('\n'))
console.log(`→ ${SRT}`)

// 5. a check frame in the middle of every line --------------------------------
mkdirSync(join(OUT, 'frames'), { recursive: true })
lines.forEach((l, i) => {
  const name = `transcript-${String(i + 1).padStart(2, '0')}-${l.id}.png`
  run(['-ss', ((l.start + l.end) / 2).toFixed(2), '-i', TOUR_T, '-frames:v', '1', join(OUT, 'frames', name)])
})
console.log(`→ frames/transcript-*.png (${lines.length})`)

// ---------------------------------------------------------------------------
function run(argv) {
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...argv], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) { console.error('ffmpeg failed with status', r.status); process.exit(1) }
}

function probeSeconds(file) {
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr || '')
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN
}

function findFfmpeg() {
  const c = []
  if (process.env.FFMPEG) c.push(process.env.FFMPEG)
  c.push('ffmpeg')
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
  if (py.status === 0 && py.stdout.trim()) c.push(py.stdout.trim())
  for (const x of c) {
    const r = spawnSync(x, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /libx264/.test(r.stdout)) return x
  }
  return null
}
