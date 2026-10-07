# demo-kit — booth video and presenter kit

Everything needed to put Trade Promotion Management into the IFPA looping reel
and to walk someone through the live demo. Built the same way as
`../sales-prorate/demo-kit` and `../grower-harvesting/demo-kit`.

| File | What it is |
|---|---|
| `scenes.mjs` | **Video source of truth:** the as-of day (`AS_OF`), scene order, seconds per scene, captions, voice-over lines, title-card labels. Edit this, then re-run the scripts below. |
| `record.mjs` | Drives the running app with Playwright (light theme) and records the tour (1920×1080) plus the title card, converts to MP4, joins them into the reel, and pulls check frames. |
| `write-script.mjs` | Regenerates `voiceover-script.md`, injects the script into `cheat-sheet.html`, and writes the single-file `trade-promotion-management-cheat-sheet.html`. |
| `transcript.mjs` | Burns the voice-over lines into the tour as on-screen text for muted playback: writes `*-tour-transcript.mp4`, `*-reel-transcript.mp4` and a `.srt`. Spoken forms become written ones on screen ("P and L" → "P&L", "fourteen million" → "$14.4M"). |
| `scratch-vo.mjs` | Lays a Windows text-to-speech read over the tour so pacing can be checked before a real voice is recorded. |
| `shot.mjs` | Screenshots every page at the recording viewport, for a quick visual check before recording. |
| `voiceover-script.md` | Generated. The narrator's copy with timecodes. |
| `interstitial.html` | The 12 s "Up next" title card. Same card as the other Bluestem apps; labels come in on the query string (`?next=`, `?tag=`, `?eyebrow=`, `?nodes=`, `?erp=`, `?link=`). |
| `cheat-sheet.html` | Presenter cheat sheet source: click path, what to say, cast, Q&A, resets, plus the voice-over script (injected from `scenes.mjs`). |
| `trade-promotion-management-cheat-sheet.html` | **Generated.** The same sheet as one self-contained file (fonts and logos inlined). This is the one to share with the team. |
| `assets/` | Poppins woff2 and the RSM marks so the HTML pages work offline. |
| `out/` | Rendered videos, frames, timing JSON and the as-of build they were recorded from (git-ignored). |

## Why an as-of build

The app's seed is anchored to `DEMO_TODAY` in `src/data/seed/index.ts`, which
defaults to the Bluestem data pack's date (2026-09-17) so the deployed site and
the tests stay reproducible. A booth video with dates three weeks stale loses
the room, so the seed also reads `VITE_DEMO_TODAY` at build time (and
`DEMO_TODAY` under node / tsx). Unset, nothing changes.

The video, voice-over and cheat sheet quote figures at `AS_OF` in `scenes.mjs`
(2026-10-07). The seed is fixed, so the same as-of always gives the same
numbers. `npm run reconcile` with `$env:DEMO_TODAY` set prints them.

## Render the video

```powershell
# 1. build the app anchored to AS_OF (not the dev server: it hangs on this OneDrive checkout)
$env:BASE_PATH = '/'; $env:VITE_DEMO_TODAY = '2026-10-07'
npx vite build --outDir demo-kit/out/app --emptyOutDir
npx vite preview --outDir demo-kit/out/app --host 127.0.0.1 --port 5188 --strictPort   # leave running

# 2. check and record (new terminal)
node demo-kit/shot.mjs                          # optional: out/check-*.png
node demo-kit/record.mjs                        # tour + title card + reel → demo-kit/out/
node demo-kit/record.mjs --only frames          # pull check frames from the MP4s
node demo-kit/transcript.mjs                    # transcript-burned tour + reel + .srt (muted floors)
node demo-kit/write-script.mjs                  # voiceover-script.md + cheat sheets
node demo-kit/scratch-vo.mjs                    # optional: TTS pacing check
```

Set env vars from PowerShell, not Git Bash (Git Bash rewrites `BASE_PATH=/`
into a Windows path). Port 5188 avoids the 5199 the Sales Proration kit uses.

`record.mjs` uses Playwright's full Chromium (`channel: 'chromium'`). For MP4 it
needs an ffmpeg with libx264: set `$env:FFMPEG`, put `ffmpeg` on PATH, or
`pip install imageio-ffmpeg`. Without one you still get WebM. It refuses to
record in anything but the light theme and warns if the build isn't anchored to
`AS_OF`.

The recorder never mutates data, not even the in-memory store: it navigates,
switches filter segments, opens and closes the deduction and fund side panels,
opens the forecast recommendation list, and hovers. It never clicks Accept,
Reject, Open dispute, Submit, Approve, Clone, Apply, Dismiss or Reset demo,
never types in the planning grid, never drags a calendar bar, and never opens
Settings.

## Change the script or the as-of day

Edit `scenes.mjs`, then:

```powershell
node demo-kit/write-script.mjs    # refresh voiceover-script.md and see the word budget check
node demo-kit/record.mjs          # re-record so the cuts land on the new timecodes
```

Keep each scene's narration under `seconds × 2.5` words; the generator flags any
line that is over. To re-anchor (say, to the show day): change `AS_OF`, rebuild
with the matching `VITE_DEMO_TODAY`, re-record, then update the figures in
`cheat-sheet.html` and the VO lines from `npm run reconcile` and the running
app. Those figures are typed into the sheet, not generated.

If a page's layout changes, the scene list in `scenes.mjs` and the `actions`
map in `record.mjs` are the only two things to rewrite; the overlay, timing
runner, MP4 conversion, reel join and title card carry over.
