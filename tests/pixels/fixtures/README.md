# Pixel fixtures

The six spike designs from proposal 3, as JSON the schema validates (`pnpm --filter @razzlr/pixels test`).

| Fixture | What it stresses |
|---|---|
| english-sale-ad | mixed weights and sizes, letter spacing, a cropped photo fill, a linear gradient band |
| hindi-ad | Devanagari conjuncts and matras (क्ष, श्री, कि), Latin digits and a rupee price |
| arabic-ad | right to left, joining forms, a Latin brand name and numbers inside Arabic, end alignment |
| shapes-and-effects | ellipses, a path with a hole, a radial gradient, drop shadow, layer blur, opacity, blend modes |
| carousel | three pages in two formats, with format overrides on texts and one image |
| stress | 300 layers and long wrapped paragraphs in all three scripts |

Image fills name assets (`sneaker`, `card-1` … `card-3`, `card-1-tall`). Their files arrive with the Node renderer ticket, which renders these designs to reference PNGs.
