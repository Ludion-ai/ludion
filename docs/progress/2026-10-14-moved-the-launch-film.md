### 2026-10-14: The launch film

- **Built**: `video/` renders the 30-second launch film in 16:9, 9:16 and 1:1 (1080p-class, 60 fps, sound) with `node video/render.mjs`. Text and numbers are read from `docs/bench/2026-10-11-done3/`, `lessons/` and a new recording of `npx ludion-ai sync` (`video/recordings/`). Decisions: `docs/decisions.md`, "The launch film".
- **Checked**: frames and frame strips from each encoded MP4 in all three formats; the sound by spectrogram, loudness per half second and integrated loudness. No one has listened to it yet.
- **Waits for the owner**: where the MP4s are kept (they are not in Git) and whether the site's top embeds one.

