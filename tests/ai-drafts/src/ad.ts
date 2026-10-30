import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const ADS_DIR = join(import.meta.dirname, '..', 'ads')

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are #RRGGBB')
const FontChoice = z.object({ family: z.string().min(1), weight: z.number().int() })

/** What a text is for in the ad, as GLOSSARY's roles name them. */
export const TextRole = z.enum(['brand', 'headline', 'subhead', 'body', 'price', 'offer', 'code', 'cta', 'badge', 'legal'])
export type TextRole = z.infer<typeof TextRole>

/**
 * One ad of the eval set: the brief a user would give, and the texts it must carry, exactly as the
 * advertiser meant them. These texts are what "spelled as intended" is checked against.
 */
export const Ad = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  language: z.enum(['en', 'hi', 'ar']),
  /** The four kinds of draft the brief names. */
  kind: z.enum(['photographic', 'graphical', 'composite', 'information']),
  format: z.object({ name: z.string(), width: z.number().int().positive(), height: z.number().int().positive() }),
  brief: z.string().min(1),
  brand: z.object({
    name: z.string().min(1),
    colors: Hex.array().min(1),
    fonts: z.object({ headline: FontChoice, body: FontChoice }),
    tone: z.string().optional(),
  }),
  texts: z.object({ role: TextRole, text: z.string().min(1) }).array().min(1),
  /** Pictures the user adds, as files in ads/assets. */
  assets: z.object({ logo: z.string().optional(), product: z.string().optional(), people: z.string().optional() }).default({}),
  /** Where the ad comes from: a real ad that ran, or a brief written for the test. */
  source: z.object({ kind: z.enum(['real', 'written']), note: z.string().optional() }),
})
export type Ad = z.infer<typeof Ad>

export function loadAds(dir = ADS_DIR): Ad[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const parsed = Ad.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')))
    if (!parsed.success) throw new Error(`ads/${f}: ${z.prettifyError(parsed.error)}`)
    if (`${parsed.data.id}.json` !== f) throw new Error(`ads/${f}: id must match the file name`)
    return parsed.data
  })
}
