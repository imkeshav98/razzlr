# Pixel fixtures

The six spike designs from the spike spec (#1), as JSON the schema validates (`pnpm --filter @razzlr/pixels test`).

| Fixture | What it stresses |
|---|---|
| english-sale-ad | the price in a group inside a clipping frame; mixed weights and sizes, letter spacing, a cropped photo fill, a linear gradient band |
| hindi-ad | Devanagari conjuncts and matras (क्ष, श्री, कि), Latin digits and a rupee price |
| arabic-ad | right to left, joining forms, a Latin brand name and numbers inside Arabic, end alignment |
| shapes-and-effects | ellipses, a path with a hole, a radial gradient, drop shadow, layer blur, opacity, blend modes |
| carousel | three pages in two formats; the portrait format overrides layout, one image and one text |
| stress | 300 layers and long wrapped paragraphs in all three scripts |

Image fills name assets (`sneaker`, `card-1` … `card-3`, `card-1-tall`): stand-in photos in `../assets/`, drawn by `scripts/make-assets.ts`.

## Reference images

`../reference/<fixture>/<page>.<format>.png` is what the Node CPU render must match, pixel for pixel. A failing check writes `<page>.<format>.actual.png` and a `.diff.png` (differing pixels in magenta) to `../output/<fixture>/`. After an intended change, rewrite them with `UPDATE_REFERENCES=1 pnpm --filter @razzlr/pixels test`, then look at every changed image before committing.

`invalid/` holds designs that must fail validation, each checked for its exact errors.
