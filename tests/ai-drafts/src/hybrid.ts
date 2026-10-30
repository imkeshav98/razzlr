import type { DesignInput } from '@razzlr/schema'
import { z } from 'zod'
import { describeAd, fontList, textList } from './brief.ts'
import type { Context } from './context.ts'
import { draw, fitText, type TextFit } from './draw.ts'
import { gemini, MODELS, nearestRatio, type Part } from './gemini.ts'
import { compose, Layout, type LayoutLayer } from './layout.ts'

const Plan = z.object({
  /** The picture only: no text, with calm room where the layout puts the copy. */
  picturePrompt: z.string().min(1),
  layout: Layout,
})

export interface HybridDraft {
  plan: z.infer<typeof Plan>
  layout: Layout
  design: DesignInput
  png: Uint8Array
  picture: Uint8Array
  fits: TextFit[]
  /** Intended texts the planner left out even after one retry. */
  missing: number[]
  /** Text layers the planner invented, dropped before drawing. */
  invented: string[]
  seconds: number
  costUsd: number
}

const rules = (ctx: Context) => [
  `Rules for the layout:`,
  `- Layers go back to front, in px of the ${ctx.ad.format.width}×${ctx.ad.format.height} format. The picture fills the whole format behind them.`,
  `- Every intended text appears exactly once as a text layer with its textIndex and its exact text. Add no other text.`,
  `- Use only these fonts, weights and scripts:\n${fontList(ctx.ad, ctx.families)}`,
  `- Size each text box generously for its text at its size; long texts wrap inside their box.`,
  `- Rects make price cards, CTA buttons, badges and bands; a scrim fades a colour over the picture behind text where it's busy.`,
  ...(ctx.assets.logo ? ['- Place the logo as an image layer with asset "logo".'] : []),
  ...(ctx.assets.product ? ['- The product photo is painted into the picture; do not add it as a layer.'] : []),
  `- Keep texts at least 5% from every edge.`,
].join('\n')

/** Checks a layout against the ad: every intended text present once, exact strings, nothing invented. */
function settle(ctx: Context, layout: Layout): { layout: Layout; missing: number[]; invented: string[] } {
  const invented: string[] = []
  const seen = new Set<number>()
  const layers = layout.layers.flatMap((l): LayoutLayer[] => {
    if (l.type !== 'text') return [l]
    const intended = l.textIndex === null ? undefined : ctx.ad.texts[l.textIndex]
    if (!intended || seen.has(l.textIndex ?? -1)) { invented.push(l.text); return [] }
    seen.add(l.textIndex ?? -1)
    return [{ ...l, text: intended.text, role: intended.role }]
  })
  const missing = ctx.ad.texts.map((_, i) => i).filter((i) => !seen.has(i))
  return { layout: { layers }, missing, invented }
}

/**
 * The hybrid path: the planner writes a picture prompt and a layout of native layers; the image
 * model paints only the picture; a second planner pass sees the picture and moves the layout
 * clear of its subject; our renderer draws the draft.
 */
export async function hybridDraft(ctx: Context, imageModel: string): Promise<HybridDraft> {
  const { ad, kit } = ctx
  const { width, height } = ad.format
  let seconds = 0
  let costUsd = 0
  const tally = (a: { seconds: number; costUsd: number }) => { seconds += a.seconds; costUsd += a.costUsd }

  const planParts = (extra: string): Part[] => [{
    text: [
      `You are the art director planning one ad draft. The image model will paint only the picture; our renderer sets every text, the logo and simple shapes on top as real layers in the brand fonts.`,
      describeAd(ad),
      ``,
      `The intended texts, numbered:`,
      textList(ad),
      ``,
      `Write picturePrompt for the image model: the photo or designed ground for this kind of ad, art directed, with calm, uncluttered room where your layout puts the copy. It must ask for no text, letters, numbers, logos or signage anywhere in the picture.`,
      rules(ctx),
      extra,
    ].join('\n'),
  }]
  let plan = await gemini({ adId: ad.id, step: `hybrid-plan:${imageModel}`, model: MODELS.text, json: Plan, parts: planParts('') })
  tally(plan)
  let settled = settle(ctx, plan.value.layout)
  if (settled.missing.length > 0 || settled.invented.length > 0) {
    plan = await gemini({ adId: ad.id, step: `hybrid-plan-retry:${imageModel}`, model: MODELS.text, json: Plan, parts: planParts(`Your previous layout left out texts ${settled.missing.join(', ')} or added others. Include every intended text exactly once.`) })
    tally(plan)
    settled = settle(ctx, plan.value.layout)
  }

  const pictureParts: Part[] = [{ text: plan.value.picturePrompt + (ctx.assets.product ? '\nThe attached photo shows the real product: keep its shape, colours and label.' : '') }]
  if (ctx.assets.product) pictureParts.push({ image: ctx.assets.product })
  const painted = await gemini({ adId: ad.id, step: `hybrid-picture:${imageModel}`, model: imageModel, parts: pictureParts, image: { aspectRatio: nearestRatio(width, height), size: '2K' } })
  tally(painted)
  const picture = draw(kit, compose({ id: ad.id, width, height, picture: 'picture', layout: { layers: [] } }), { picture: painted.value }).png

  const firstDraft = render(ctx, settled.layout, picture)
  const fit = await gemini({
    adId: ad.id, step: `hybrid-fit:${imageModel}`, model: MODELS.text, json: z.object({ layout: Layout }),
    parts: [
      {
        text: [
          `You are the art director finishing an ad draft. The first image is the painted picture (${width}×${height} px). The second is the draft with the planned layers on it. The planned layout is below as JSON.`,
          `Return the final layout: move and resize layers so no text or shape covers the subject's face or the product, every text reads clearly against what is behind it (add a scrim, band or card where the picture is busy), the hierarchy is clear and the ad looks finished. Keep each text's textIndex and exact text.`,
          rules(ctx),
          JSON.stringify(settled.layout),
        ].join('\n'),
      },
      { image: picture },
      { image: firstDraft.png },
    ],
  })
  tally(fit)
  const final = settle(ctx, fit.value.layout)
  const done = final.missing.length === 0 ? final : settled
  const drawn = render(ctx, done.layout, picture)
  return { plan: plan.value, layout: done.layout, design: drawn.design, png: drawn.png, picture, fits: drawn.fits, missing: done.missing, invented: [...settled.invented, ...final.invented], seconds, costUsd }
}

function render(ctx: Context, layout: Layout, picture: Uint8Array) {
  const { ad, kit, assets } = ctx
  const { design, fits } = fitText(kit, compose({ id: ad.id, width: ad.format.width, height: ad.format.height, picture: 'picture', layout }))
  const images: Record<string, Uint8Array> = { picture }
  if (assets.logo) images.logo = assets.logo
  if (assets.product) images.product = assets.product
  return { png: draw(kit, design, images).png, fits, design }
}
