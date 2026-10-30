# AI draft test (#24)

Compares two ways of making an AI ad draft on a fixed set of ads, scored on the brief's phase 2 measure: **every text live and spelled as intended**.

- **Flat (the brief):** an image model paints the whole ad, text included. Then the layering steps that decide its text run: a vision model lists and reads each text block and matches it to one of our fonts, an image edit erases the text to make a backdrop, and each block is placed back as a live text layer (or kept as a cut-out when no font fits). GPU layer separation isn't reachable from the build container, so the image edit stands in for it.
- **Hybrid:** the planner writes a picture prompt and a layout of native layers (text, logo, cards, CTA, scrims) in the brand fonts. The image model paints only the picture. A second planner pass sees the picture and fits the layout around its subject. Our renderer draws the draft.

## Measures

| Measure | How |
|---|---|
| Flat, as drawn | A reader transcribes the flat draft exactly as drawn; every intended text must be found spelled right (`src/match.ts`) and nothing else written |
| Flat, after layering | Every intended text became a live layer; no other text left as a layer or a cut-out |
| Hybrid | Every intended text placed, none overflowing after auto-fit, no stray text visible from the picture |
| Reader error | The same reader on hybrid drafts, whose texts we drew, gives its own error rate |
| Look | A blind pairwise judge, asked in both orders |
| Fidelity | How closely the flat path's editable design still looks like the draft |
| Contrast | WCAG ratio of each hybrid text against what's behind it |
| Time and cost | Every model call in `runs/ledger.jsonl` |

## Running it

```sh
pnpm fonts                                 # brand fonts, pinned by SHA-256 in fonts.json
GEMINI_API_KEY=… pnpm run-test             # every ad in ads/, both image models
GEMINI_API_KEY=… pnpm run-test hi-diwali   # one ad
pnpm report                                # tables for docs/spike/ai-draft-test.md
```

Calls are cached in `runs/cache` by their request, so a rerun only pays for what changed. The run stops at `AI_DRAFTS_BUDGET_USD` (default $50). Models can be swapped with `AI_DRAFTS_TEXT_MODEL`, `AI_DRAFTS_IMAGE_PRO` and `AI_DRAFTS_IMAGE_FLASH`.

## The eval set

`ads/*.json`, one ad per file (`src/ad.ts`): the brief, the brand kit, the format and the intended texts. Pictures the user would add go in `ads/assets/`. `source.kind` says whether an ad is a real one that ran or a brief written for the test.

`pnpm test` checks the composer, auto-fit, font coverage, contrast and the text matcher without calling any model.
