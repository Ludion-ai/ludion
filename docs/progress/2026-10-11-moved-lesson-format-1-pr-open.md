### 2026-10-11: Lesson format 1 (PR open)

- Built: format 1 schema (structured fields, generated claim, grounded `detail`, `signal`, pinned and differential tests), the frozen format 0 schema for old lessons, `generateClaim`, the grounding and symbol checks in `verify`, and two-step Docker runs for tests that pin packages. The leftovers of #13 are gone.
- Check: 231 tests pass, including new ones for every field rule, the security guard on `symbol`, the differential label, and the runner's commands. Docker isn't installed on the machine that built it, so the first real run of a pinned test happens in CI with the first format 1 lesson.

