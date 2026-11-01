# Phase 1 exit report

Phase 1 (#27) promised an editor core in which a designer rebuilds a real ad set in 5 formats, and every export matches the editor. **The automated exit check passes. The last check, Keshav rebuilding an ad set of his own by hand, is still to do**, and its notes go in the section at the end.

Measured on 2026-11-01 on Keshav's PC (Windows 11, Chromium 1.63 headless with SwiftShader, the production web build) and in CI on GitHub's Ubuntu runners. Every number below names its source.

## Exit checks

| Exit check (#27, #61) | Pass mark | Measured | Result |
|---|---|---|---|
| A real ad set rebuilt in 5 formats through real input | The scenario runs end to end with no page errors | `exit-check.spec.ts`: brief, two brand colours, a photo and a font uploaded, a page fill, a badge and a headline sized on the slider, 4 formats added, the headline moved in one format only, 20 files exported through the Export menu | **Pass** |
| PNG and JPG export parity | 0 differing pixels against the Node render | All 10 PNG and JPG files of the exit check are byte-identical to Node's. Every pixel fixture's PNG and JPG are too (19 page-format cases), and the CPU parity checks show 0 differing pixels in all 58 cases | **Pass** |
| PDF and SVG within the vector tolerance | ≤ 1% of pixels differing for the exit check's ad (fixtures: their recorded baselines) | Exit check, drawn by pdfium and resvg: PDF 0.039–0.492%, SVG 0.001–0.089%. All 10 files are byte-identical to Node's | **Pass** |
| PDF text stays text at the renderer's glyph positions | Within 0.05 px | Largest distance 0.0001 px, over 16,037 glyphs in the stress fixture and every glyph in the other fixtures; Hindi and Arabic 0 px | **Pass** |
| Keshav rebuilds an ad set of his own | His notes are in this report | Not done yet | **Open** |

## The exit check, format by format

`tests/e2e/specs/exit-check.spec.ts`, local run on 2026-11-01, written to `tests/e2e/output/exit-check.json` with screenshots and a recording (`exit-check.webm`), which CI uploads with the e2e output.

| Format | Size | PNG | JPG | PDF | SVG | PDF differing | SVG differing |
|---|---|---|---|---|---|---|---|
| Feed square | 1080×1080 | 76,720 B | 39,387 B | 307,066 B | 84,869 B | 0.121% | 0.037% |
| Feed portrait | 1080×1350 | 78,524 B | 41,283 B | 307,069 B | 84,896 B | 0.097% | 0.030% |
| Story (headline moved) | 1080×1920 | 72,072 B | 31,294 B | 306,198 B | 84,962 B | 0.039% | 0.001% |
| Link image | 1200×628 | 46,208 B | 26,403 B | 307,088 B | 48,672 B | 0.148% | 0.082% |
| Medium rectangle | 300×250 | 10,750 B | 5,398 B | 306,507 B | 21,338 B | 0.492% | 0.089% |

Every file is byte-identical to Node's export of the same design, drawn with the same font and photo bytes. A pixel counts as differing only when nothing within one pixel of it in the CPU render is within 16 of 255 on every channel (`tests/pixels/src/vector.ts`). The PDFs are about 300 KB each because the photo is stored losslessly.

## How each was measured

- **Exit scenario:** Playwright drives the production web app with the mouse and keyboard only, against the e2e suite's own API, sync server and database. The design comes from the brief. The brand kit, photo and font are added through the brand flyout, asset library and font picker. Shapes and text are drawn with the tools, and the formats come from the Add format presets. The exports are downloaded as zips from Share › Export.
- **Export parity and vectors on the fixtures:** `tests/pixels`, both its Playwright suite (`specs/export.spec.ts`, `specs/parity.spec.ts`) and its Node suite (`src/vector.test.ts`, `src/render.test.ts`). Per-fixture vector baselines are in `tests/pixels/reference/vector-baselines.json`. The largest are the text-heavy stress page (PDF 5.1%) and text-styles page (PDF 2.7%), all at glyph edges, where pdfium and resvg skip FreeType's hinting. The ad fixtures are 0.75% or less.
- **Glyph positions:** `tests/pixels/src/pdf-glyphs.ts` reads where each PDF draws every glyph, and the check compares each one with where the renderer lays out the same glyph.

## Known gaps

- Copying Hindi or Arabic text out of a PDF gives broken characters, though it draws and sits correctly: Skia's paragraph module doesn't hand the PDF writer the text behind each glyph cluster. English copies cleanly.
- SVG text is drawn as shapes, so it looks the same everywhere but can't be edited as text in another app.
- A format added from a preset scales the primary layout to fit, but text stays its size, so the banner and medium rectangle need a designer's hand. Adapting layouts is phase 3.

## Keshav's own ad set

To do: rebuild one of your own ad sets by hand in the app, export every format, and note here what was slow, missing or wrong.
