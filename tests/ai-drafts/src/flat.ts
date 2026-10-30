import type { DesignInput } from '@razzlr/schema'
import { z } from 'zod'
import { describeAd, textList } from './brief.ts'
import { compose, Box, type Layout, type LayoutLayer } from './layout.ts'
import { draw, fitText, type TextFit } from './draw.ts'
import { gemini, MODELS, nearestRatio, type Part } from './gemini.ts'
import { scriptsOf, type BrandFamily } from './fonts.ts'
import { specimen } from './specimen.ts'
import type { Context } from './context.ts'

/** Step 0 of the flat path: one image model call paints the whole ad, text and all. */
export async function flatDraft(ctx: Context, model: string): Promise<{ png: Uint8Array; seconds: number; costUsd: number }> {
  const { ad } = ctx
  const parts: Part[] = [{
    text: [
      `Design a finished, professional advertisement image.`,
      describeAd(ad),
      ``,
      `The ad must show exactly these texts, each spelled exactly as given, character for character, and no other text, letters or numbers anywhere in the image:`,
      textList(ad),
      ``,
      `Set each text in lettering close to the brand fonts named above. Keep every text inside the frame with a margin of at least 6% of the width; the image will be cropped to ${ad.format.width}×${ad.format.height}.`,
      ...(ctx.assets.logo ? ['The first attached image is the brand logo: place it unchanged.'] : []),
      ...(ctx.assets.product ? ['The attached product photo shows the real product: keep its shape, colours and label.'] : []),
    ].join('\n'),
  }]
  if (ctx.assets.logo) parts.push({ image: ctx.assets.logo })
  if (ctx.assets.product) parts.push({ image: ctx.assets.product })
  const answer = await gemini({ adId: ad.id, step: `flat-draft:${model}`, model, parts, image: { aspectRatio: nearestRatio(ad.format.width, ad.format.height), size: '2K' } })
  // The model paints at the nearest ratio it supports; our renderer covers the format with it.
  const png = draw(ctx.kit, compose({ id: ad.id, width: ad.format.width, height: ad.format.height, picture: 'draft', layout: { layers: [] } }), { draft: answer.value }).png
  return { png, seconds: answer.seconds, costUsd: answer.costUsd }
}

export const ReadBlock = z.object({
  /** Exactly what is drawn, mistakes included; � for a glyph that can't be read. */
  seen: z.string(),
  /** Which intended text this block is meant to be, or null for text the ad didn't ask for. */
  textIndex: z.number().int().min(0).nullable(),
  /** font: set in a typeface; hand: hand lettering or script; effect: 3D, warped, textured or woven into the art. */
  lettering: z.enum(['font', 'hand', 'effect']),
  box: Box,
  family: z.string(),
  weight: z.number().int(),
  size: z.number().positive(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  align: z.enum(['start', 'center', 'end']),
  lineHeight: z.number().positive().nullable(),
  letterSpacing: z.number().nullable(),
  shadow: z.boolean(),
})
export type ReadBlock = z.infer<typeof ReadBlock>
const ReadAnswer = z.object({ blocks: ReadBlock.array() })

/**
 * Steps 1, 3 and 4 of the brief's layering, in one vision call: list every text block a designer
 * would move as one unit, read it exactly as drawn, say which intended text it is meant to be, and
 * match its lettering to one of our fonts from a specimen sheet drawn by our renderer.
 */
export async function readDraft(ctx: Context, png: Uint8Array, label: string) {
  const { ad, kit, families } = ctx
  const script = ad.language === 'hi' ? 'devanagari' : ad.language === 'ar' ? 'arabic' : 'latin'
  const library = families.filter((f) => f.scripts.includes(script))
  const answer = await gemini({
    adId: ad.id, step: `read:${label}`, model: MODELS.text, json: ReadAnswer,
    parts: [
      {
        text: [
          `You are the text step of a pipeline that turns a flat ad image into editable layers.`,
          `The first image is a ${ad.format.width}×${ad.format.height} px ad. List every text block in it that a designer would move as one unit, front to back.`,
          `For each block:`,
          `- seen: transcribe exactly what is drawn, letter by letter and mark by mark. Never correct spelling, never complete words, never normalise. Write � for any glyph that is malformed or can't be read. This is checked strictly.`,
          `- textIndex: which of the advertiser's intended texts (below) the block is meant to be, or null if none.`,
          `- lettering: "font" if set in an ordinary typeface; "hand" for hand lettering or script; "effect" for 3D, warped, textured or art-integrated lettering no font could reproduce.`,
          `- box: x, y, w, h in px of the ad.`,
          `- family and weight: the closest font from the second image, a specimen sheet; use only those labels' family names and weights.`,
          `- size in px, color as #RRGGBB, align, lineHeight (multiple of size, or null), letterSpacing in px (or null), shadow.`,
          `The advertiser's intended texts:`,
          textList(ad),
        ].join('\n'),
      },
      { image: png },
      { image: specimen(kit, library, script).png },
    ],
  })
  return answer
}

/** The flat path's editable result: backdrop, then each block as live text or, if no font fits, a cut-out. */
export interface Editable {
  layout: Layout
  design: DesignInput
  png: Uint8Array
  fits: TextFit[]
  /** Per intended text: became a live text layer. */
  live: boolean[]
  /** Blocks that became live text but aren't any intended text. */
  strayLive: string[]
  seconds: number
  costUsd: number
}

/**
 * Steps 2 and 6 stand-in, then 7: GPU separation can't run here, so an image edit erases the text
 * to make the backdrop, and each read block is placed back as live text in its matched font. A
 * block mapped to an intended text gets that text, as the brief's read step fixes spelling slips.
 */
export async function makeEditable(ctx: Context, draft: Uint8Array, blocks: ReadBlock[], label: string): Promise<Editable> {
  const { ad, kit, families } = ctx
  const backdrop = await gemini({
    adId: ad.id, step: `backdrop:${label}`, model: MODELS.imageFlash, image: { aspectRatio: nearestRatio(ad.format.width, ad.format.height), size: '2K' },
    parts: [
      { text: 'Remove every piece of text, lettering, numbers and words from this ad image. Keep everything else exactly as it is: the photo, product, people, shapes, buttons, cards, badges and logo symbols (but not their words). Fill where the text was with what is behind it.' },
      { image: draft },
    ],
  })
  const layers: LayoutLayer[] = blocks.map((b): LayoutLayer => {
    const live = b.lettering === 'font' && knownFont(families, b.family, b.weight, b.seen)
    if (!live) return { type: 'cutout', name: b.seen.slice(0, 40), box: b.box }
    const intended = b.textIndex === null ? undefined : ad.texts[b.textIndex]
    return {
      type: 'text', role: intended?.role ?? 'body', textIndex: intended ? b.textIndex : null, text: intended?.text ?? b.seen,
      box: b.box, family: b.family, weight: b.weight, size: b.size, color: b.color, align: b.align,
      lineHeight: b.lineHeight, letterSpacing: b.letterSpacing, shadow: b.shadow,
    }
  })
  const layout = { layers }
  const { design, fits } = fitText(kit, compose({ id: ad.id, width: ad.format.width, height: ad.format.height, picture: 'backdrop', layout }))
  const png = draw(kit, design, { backdrop: backdrop.value, draft }).png
  const textLayers = layers.filter((l) => l.type === 'text')
  return {
    layout, design, png, fits,
    live: ad.texts.map((_, i) => textLayers.some((l) => l.textIndex === i)),
    strayLive: textLayers.filter((l) => l.textIndex === null).map((l) => l.text),
    seconds: backdrop.seconds,
    costUsd: backdrop.costUsd,
  }
}

function knownFont(families: BrandFamily[], family: string, weight: number, text: string): boolean {
  const f = families.find((x) => x.family === family)
  return !!f && f.weights.includes(weight) && scriptsOf(text).every((s) => f.scripts.includes(s))
}
