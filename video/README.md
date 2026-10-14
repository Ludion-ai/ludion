# The launch film

A 30-second film for the launch: for X, and for the top of the site. One idea: **a change you can't see becomes one you can.** A dependency changes without a sound; the assistant answers from what it learned, sure of itself, and wrong; `npx ludion-ai sync`; the same question, answered right.

Drawn one frame at a time (no screen recording), with sound synthesized in code (no recorded music, no samples). Every answer, terminal line and number on screen is read from a record in this repository when the film renders.

## Render it

```sh
npm ci                       # at the repository root, once (Chromium for Playwright, the site's fonts)
node video/render.mjs        # all three formats, with sound, into video/out/ (installs video/'s ffmpeg on first run)
```

| file | size | |
| - | - | - |
| `out/ludion-launch-16x9.mp4` | 1920 × 1080, 60 fps | the main cut |
| `out/ludion-launch-9x16.mp4` | 1080 × 1920, 60 fps | vertical |
| `out/ludion-launch-1x1.mp4` | 1080 × 1080, 60 fps | square |

H.264 (High, CRF 15, BT.709), AAC 320 kb/s, 48 kHz, −14 LUFS integrated with peaks under −1 dBTP. `video/out/` is not committed (`.gitignore`); where the finished MP4s live is the owner's call.

For working on it:

```sh
node video/render.mjs --format 16x9 --stills 1.08,11.2,15.1   # single frames as PNG
node video/render.mjs --format 9x16 --sheet                   # one frame every half second, tiled
node video/render.mjs --format 16x9 --from 10 --to 16          # a part, without sound
node video/render.mjs --audio-only                            # the WAV, its spectrogram and waveform
```

## How it is made

- `src/timeline.mjs`: the one clock. Scene boundaries, every cue, the tempo (120 BPM, bars on odd seconds so the slam, the stamp and the drop are downbeats), typing times, and the kick drums. The picture and the sound both read it, so a cut and its sound can't drift apart.
- `src/page/`: the picture, an HTML page with a function `render(t)` that sets every element from `t` alone. `water.js` is the site's water shader (`apps/site/src/scripts/water.js`) driven by the film's clock; `stage.js` lays out and moves the scenes; `stage.css` holds the three formats.
- `render.mjs`: serves the page, opens it in headless Chromium (GPU when there is one, software WebGL otherwise), calls `render(frame / 60)` for every frame, captures it, and pipes the frames in order into ffmpeg. Four pages render frames side by side.
- `src/audio/`: the sound. `dsp.mjs` is a small synthesizer (band-limited saws, a state-variable filter, Karplus-Strong strings, FM bells, a Freeverb reverb, a ping-pong delay, a tape stop, a limiter); `score.mjs` is the arrangement. Nothing is loaded from a file.
- Fonts are the site's own (Schibsted Grotesk, JetBrains Mono, both SIL OFL), read from the root `node_modules`. The mark is `BrandMark.astro`'s geometry; the wordmark is `apps/site/src/assets/wordmark.svg`; the closing line is the home page's headline (`apps/site/src/strings/en.ts`).

## What is on screen, and where it comes from

| on screen | source |
| - | - |
| the silent changes in the opening montage, and the wall behind them | `lessons/` on this branch, each sentence built by `generateClaim` (`packages/core`); all are seed lessons, so the montage carries "Taught by @Ludion-ai, drafted by an agent" |
| "Code written for older versions still runs, without an error." | the same generated claim (vitest `extends`, `01M4N4KZ0QT41TY27SW0E683RX`) |
| the question, both answers, "graded wrong" / "graded correct" | `docs/bench/2026-10-11-done3/` (`questions.json`, `answers-B-*.json`, `grades-B-*.json`), question `vitest-5-0-0-14-b`: Claude Code (`claude-opus-5-5`) in a project with vitest 5.0.3 installed. Both answers are excerpts: the text up to a cut, then "…" |
| `npx ludion-ai sync` and its two lines of output | `recordings/sync-output.txt` (below) |
| the lesson card: claim, detail, the two test runs, the teacher line | the lesson file, and the line sync wrote under it in `recordings/lessons.md` ("Taught by @Ludion-ai, drafted by an agent; verified by tests across versions on 2026-10-12."). The runs say what CI requires ("must fail" on 4.1.11, "must pass" on 5.0.0), as the site's lesson pages do |
| 45 questions, 24 and 36 | counted from `grades-B-project.json` and `grades-B-project-sync.json` at render time (`docs/bench/2026-10-11-done3/README.md`) |

The with-sync answer was recorded with the lessons as frozen on 2026-10-11, served from a local build; the sync scene shows a run of the published CLI on 2026-10-14. The lesson's text is the same in both (`docs/demo/README.md` explains the same split for the demo cast). The film's own words are only the scene titles: "The software changed.", "Silent.", "Without Ludion", "Confidently wrong.", "With ludion sync", "Correct.".

### The recordings

`recordings/` was made on 2026-10-14 (09:48 UTC) in a copy of `tools/bench/projects/vitest` with a lockfile from `npm install --package-lock-only --ignore-scripts` (vitest 5.0.3), an empty `LUDION_HOME`, and no model set, by running exactly `npx ludion-ai sync` (ludion-ai 0.1.4, npm `latest` then). `sync-output.txt` is everything the terminal printed, including npx's one-time install notice, which the film leaves out; `lessons.md` is the file sync wrote.

## How it was checked

Every scene was looked at as single frames and as strips of frames from the encoded MP4, in all three formats, and fixed until it read. The sound was checked without ears: a spectrogram, a waveform, loudness per half second (quiet under water at "Silent.", true silence after the stamp, the command typed into that silence, the drop), and the integrated loudness and true peak ffmpeg measures. Nobody has listened to it yet; that is the one check left for a person.
