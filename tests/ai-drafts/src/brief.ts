import type { Ad } from './ad.ts'
import type { BrandFamily } from './fonts.ts'

/** The four kinds of draft, as the brief describes them. */
export const KINDS: Record<Ad['kind'], string> = {
  photographic: 'photographic: a photo fills the whole ad',
  graphical: 'graphical: the product cut out on a designed ground',
  composite: 'composite: a photo combined with bold graphic shapes',
  information: 'information-rich: the product with a card of key facts',
}

const LANGUAGES: Record<Ad['language'], string> = {
  en: 'English',
  hi: 'Hindi, in Devanagari script',
  ar: 'Arabic, in Arabic script, read right to left',
}

/** The intended texts, numbered from 0, quoted exactly. */
export const textList = (ad: Ad) => ad.texts.map((t, i) => `${i}. [${t.role}] "${t.text}"`).join('\n')

/** Everything the user's brief and brand kit say, as both paths' planners read it. */
export function describeAd(ad: Ad): string {
  const { brand, format } = ad
  return [
    `Ad for ${brand.name}. Brief: ${ad.brief}`,
    `Format: ${format.name}, ${format.width}×${format.height} px.`,
    `Kind of ad: ${KINDS[ad.kind]}.`,
    `Language of the copy: ${LANGUAGES[ad.language]}.`,
    `Brand colours: ${brand.colors.join(', ')}.`,
    `Brand fonts: headlines in ${brand.fonts.headline.family} (weight ${brand.fonts.headline.weight}), body in ${brand.fonts.body.family} (weight ${brand.fonts.body.weight}).`,
    ...(brand.tone ? [`Tone of voice: ${brand.tone}.`] : []),
  ].join('\n')
}

/** The fonts a layout may use: the brand's two families, with the weights we have and the scripts they draw. */
export function fontList(ad: Ad, families: BrandFamily[]): string {
  const names = [...new Set([ad.brand.fonts.headline.family, ad.brand.fonts.body.family])]
  return names.map((name) => {
    const f = families.find((x) => x.family === name)
    if (!f) throw new Error(`${ad.id}: brand font ${name} is not in fonts.json`)
    return `- "${f.family}": weights ${f.weights.join(', ')}; draws ${f.scripts.join(', ')}`
  }).join('\n')
}
