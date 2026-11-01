# Pixel fixtures

The spike designs from the spike spec (#1), as JSON the schema validates (`pnpm --filter @dazbee/pixels test`).

| Fixture | What it stresses |
|---|---|
| english-sale-ad | the price in a group inside a clipping frame that cuts off the was-price; mixed weights and sizes, letter spacing, a cropped photo fill, a linear gradient band |
| hindi-ad | Devanagari conjuncts and matras (क्ष, श्री, कि), Latin digits and a rupee price |
| arabic-ad | right to left, joining forms, a Latin brand name and numbers inside Arabic, end alignment |
| image-fills | image fills (#48): fill, fit, crop and tile in a rounded rect, an ellipse, a turned star and a turned rounded rect; each adjustment and each filter; a star alpha mask over a photo and a translucent band; a radial luminance mask fading a photo in a clipping frame; bold text as a mask, then a turned translucent ellipse mask taking the next layer; a pill on the page masking the photo strip after it |
| auto-layout | auto layout (#46): buttons that hug labels of two lengths; a card column that hugs, a photo that fills its width, text that fills the width and wraps, a button, and an absolute badge; space-between stats; overlapping avatars on a negative gap; tags that wrap onto lines; a turned column whose children fill its height |
| text-styles | text styles (#47) in English, Hindi and Arabic: a filled outline and a hollow one, strikethrough and underline runs, upper and title case with a Latin word inside Devanagari and Arabic, bullet and numbered lists that wrap clear of their markers (on the right for Arabic) with paragraph spacing, two lines and an ellipsis, shrink to fit growing to fill a box and one too small held at its least size and cut to a line |
| shapes-and-booleans | preset shapes and booleans (#44): rects with their own corner radii, polygons and stars, plain, rounded, turned, dashed and stroked inside; lines with arrow, triangle and circle ends, dashed, thick and turned; a live boolean for each operation; a turned subtract with a turned cutter and a line operand that adds nothing; a boolean nested in another, with a shadow; a translucent union with a hidden operand |
| shapes-and-effects | ellipses, a path with a hole, a radial gradient, drop shadow, layer blur, opacity, blend modes |
| carousel | three pages in two formats; the portrait format overrides layout, one image and one text |
| layer-bounds | the offscreen layer bounds (#18): a thick translucent mitred stroke, a translucent outside stroke, a translucent path larger than its box, a turned frame with a shadowed child, a turned blurred ellipse |
| text-and-group-bounds | the offscreen layer bounds of text and groups (#31): translucent, shadowed, blurred and multiplied text in all three scripts, a fixed box its text spills out of, a turned translucent group with a shadow, a blurred group holding a turned translucent group |
| groups-and-frames | groups and frames (#41): a turned clipping frame cutting off a circle and a turned group, a clipping frame nested in that group, a frame that doesn't clip, a translucent group of overlapping shapes |
| strokes-and-effects | schema version 2 (#43): angular gradients on a fill and a stroke, dashes with an odd list and an offset, butt, round and square caps, mitre, round and bevel joins and a miter limit, inner shadows, glow on a shape and on text, background blur behind a turned translucent card, and groups of multiplied circles that pass through, are drawn together, and pass through at 60% opacity |
| stress | 300 layers and long wrapped paragraphs in all three scripts |

Image fills name assets (`sneaker`, `card-1` … `card-3`, `card-1-tall`, `tile`): stand-in photos in `../assets/`, drawn by `scripts/make-assets.ts`.

## Reference images

`../reference/<fixture>/<page>.<format>.png` is what the Node CPU render must match, pixel for pixel. A failing check writes `<page>.<format>.actual.png` and a `.diff.png` (differing pixels in magenta) to `../output/<fixture>/`. After an intended change, rewrite them with `UPDATE_REFERENCES=1 pnpm --filter @dazbee/pixels test`, then look at every changed image before committing.

## Screen drift

The editor screen draws on WebGL and exports on the CPU, so they can differ slightly at anti-aliased edges and in blur (ADR-0005). The Playwright parity suite measures this drift for every page in every format and fails when it passes the limit in `../reference/webgl-drift.json`. A limit is set when a baseline is recorded: a quarter more pixels than measured plus 0.05 percentage points, and 16 levels more in any channel. After an intended change, record new baselines with `UPDATE_DRIFT_BASELINES=1 pnpm --filter @dazbee/pixels e2e`, then check the stage by eye before committing. A new fixture needs a baseline too.

`invalid/` holds designs that must fail validation, each checked for its exact errors.

## Text checks

`src/shaping.test.ts` compares the glyph ids and positions SkParagraph produces with `hb-shape` (HarfBuzz's own command line tool, `apt install libharfbuzz-bin`) for every string in `src/text-samples.ts`. hb-shape shapes one font in one direction, so the test does the rest itself: it splits right-to-left strings into Latin, number and Arabic runs, and shapes characters the face lacks with Noto Sans, as Skia's fallback does. CI installs hb-shape from Ubuntu 24.04 (HarfBuzz 8.3.0), which is older than the HarfBuzz inside CanvasKit; if they ever disagree on a string, check which one is right before changing anything.

`src/caret.test.ts` clicks on every grapheme of those strings, and of Latin inside Arabic, and checks that the caret lands on the grapheme's near edge from anywhere up the line, that each grapheme has one selection box in its own direction around its glyphs, and that clicks on wrapped text stay on the line clicked.
