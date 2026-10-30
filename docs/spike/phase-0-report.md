# Phase 0 spike report

The spike (#1) asked whether one CanvasKit renderer can keep the brief's promise: screen and exports that match, English, Hindi and Arabic set correctly, and several people editing one design at once. **It can. Every exit check passes, and phase 1 can build on the renderer as it is.** The follow-ups at the end are things to fix along the way, not reasons to change course.

Measured on 2026-10-30 at the merge of #18. "One core" means the cloud container pinned with `taskset -c 0`, standing in for Keshav's 1 vCPU, 3.8 GB server (ADR-0008), because the on-server run (#9) was skipped. Server numbers on the real machine may be somewhat slower, since its vCPU is shared.

## Exit checks

| Exit check (spec #1) | Pass mark | Measured | Result |
|---|---|---|---|
| Export parity: Node CPU vs browser CPU | 0 differing pixels | 0 differing pixels on all 12 fixture renders | **Pass** |
| Screen vs export: WebGL stage vs CPU export | No drift visible by eye at 100%; these numbers become the baseline | Text fixtures: 0–0.34% of pixels, at most 1 level (Devanagari: 0.09%, at most 39 levels, at glyph edges). Effects fixtures: 13–25% of pixels, at most 63 levels, in blur and shadow gradients | **Pass** (baseline set) |
| Glyphs identical to `hb-shape` | Identical glyph ids, clusters within 0.05 px | 11/11 strings identical, including Devanagari conjuncts and Arabic with Latin and numbers | **Pass** |
| Caret on the right grapheme, including Arabic RTL | Every grapheme, every edge | 411 checks pass: clicks across each grapheme and line, selection boxes, wrapped lines | **Pass** |
| Two tabs × 200 random edits end identical | Same document and same pixels | Same design JSON, same export SHA-256, byte-identical WebGL stages; about 180 remote updates arrived mid-run in each tab | **Pass** |
| Undo never touches the other tab's edits | Never | Different keys, same key, text, drag and typing gestures, all through the sync server | **Pass** |
| Edit latency, tab A command to tab B redraw | p95 ≤ 100 ms on one machine | median 11 ms, p95 28 ms (50 edits) | **Pass** |
| Server render time | ≤ 1 s per 1080×1080 render on one core | 137–273 ms for the ad fixtures, 714 ms for the 300-layer stress page | **Pass** |
| Server render, whole carousel | ≤ 60 s for a 20-card × 5-format carousel on one core | 100 renders: 251 ms median, 562 ms max, 24.9 s in all | **Pass** |
| Server peak memory | ≤ 1 GB (the server also runs Postgres, Redis, API and sync in 3.8 GB) | 116 MB after start; 361 MB peak over all fixtures and the carousel | **Pass** |
| Yjs size, 20-card × 5-format carousel | ≤ 1 MB | 152 KB (19 KB gzipped) fresh; 162 KB (22 KB gzipped) after 1,000 more edits. 120 layers, 2,020 override values | **Pass** |

## How each was measured

- **Parity and drift:** `tests/pixels` Playwright suite (#6). Each fixture is rendered in Chromium on the CPU and on WebGL (SwiftShader), and compared with the Node render. The drift table goes to the CI summary and the `webgl-vs-cpu` artifact on every run.
- **Shaping and caret:** `tests/pixels/src/shaping.test.ts` and `caret.test.ts` (#7) run against hb-shape 8.3.0.
- **Live editing:** `tests/e2e/specs/live-editing.spec.ts` (#8), two Chromium contexts through Hocuspocus and Postgres in Docker Compose. Screenshots and `latency.json` are in the `live-editing` CI artifact.
- **Server:** `taskset -c 0 node tests/pixels/scripts/measure-server.ts` renders every fixture page and format three times, plus all 100 carousel renders. Peak memory is the process's max RSS.
- **Document:** `taskset -c 0 node tests/pixels/scripts/measure-doc.ts` builds the carousel (`tests/pixels/src/big-carousel.ts`), with six layers per card and every non-primary format overriding every layer's layout.

## Server render times (one core)

| Fixture page.format | Size | Render |
|---|---|---|
| arabic-ad p1.sq | 1080×1080 | 230 ms |
| english-sale-ad p1.sq | 1080×1080 | 204 ms |
| hindi-ad p1.sq | 1080×1080 | 137 ms |
| shapes-and-effects p1.sq | 1080×1080 | 273 ms |
| carousel, 6 renders | 1080×1080 and 1080×1350 | 188–273 ms |
| stress p1.sq (300 layers) | 1080×1080 | 714 ms (15.5 s before #18) |
| big carousel, 100 renders | 5 formats | 251 ms median, 562 ms max |

Each render includes decoding all the fonts and every fixture image again, 55–70 ms of the time. A worker that keeps them between renders would be that much faster.

## Screen vs export baseline

| Fixture | Differing pixels | Largest channel difference |
|---|---|---|
| arabic-ad | 0% | 0 |
| english-sale-ad | 0.022% | 1 |
| carousel (6 renders) | 0.07–0.34% | 1 |
| hindi-ad | 0.094% | 39 |
| shapes-and-effects | 13.4% | 42 |
| layer-bounds | 18.4% | 43 |
| stress | 25.0% | 63 |

The editor screen is a preview, and exports are always drawn on the CPU (ADR-0005), so drift never reaches a deliverable. The differences sit in blur and shadow gradients and at anti-aliased edges, and nothing moves. The pass mark is that nothing is visible at 100%. CI prints this table on every run. Failing CI when a fixture drifts well past these numbers is a small follow-up.

## What else the spike found

- **A command reads the whole design before it runs:** 16 ms median on one core for the 120-layer carousel (`readDesign` alone is 26 ms). That is fine for the spike, but typing in a 500-layer design would lag. Phase 1 should check commands against the part of the design they touch.
- **Text and groups draw into unbounded offscreen layers** when translucent or effected (#18 bounded everything else). These need their drawn extent before they can be bounded.
- **Ellipse anti-aliasing shifts by a few levels** depending on where an offscreen layer starts (stress: 723 pixels, at most 10 levels). This is harmless, since Node and browser CPU still match exactly.
- **Devanagari on WebGL** differs from the export by up to 39 levels at glyph edges, more than Latin or Arabic does. It is not visible at 100%, but worth checking at small sizes when the editor's text rendering is tuned.
- **The sync server has no auth.** It runs only locally and in CI until phase 1 adds it.

## Recommendation

Build phase 1 on the renderer as it is: CanvasKit 0.42 full build, one drawing path for WebGL and CPU, exports on the CPU, and our own font bytes. The risky promises held: export parity is exact, all three scripts shape like HarfBuzz, and live editing converges with undo kept to its own tab. Take the first two findings above into phase 1's editor-core tickets. The agreed next step comes before any phase 1 work: the AI draft test (flat vs hybrid drafts).
