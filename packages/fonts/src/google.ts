/**
 * The Google Fonts families Razzlr offers (#50). They are copied into our storage once, by
 * `pnpm --filter @razzlr/api fonts:google`, and from then on loaded from there like any other font
 * file: never from Google, the system or the browser at render time.
 */
export interface GoogleFamily {
  family: string
  category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace'
  weights: readonly number[]
  /** Whether each weight has an italic too. */
  italic: boolean
}

export const GOOGLE_FONTS: readonly GoogleFamily[] = [
  { family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700, 800, 900], italic: false },
  { family: 'Roboto', category: 'sans-serif', weights: [400, 500, 700, 900], italic: true },
  { family: 'Open Sans', category: 'sans-serif', weights: [400, 600, 700, 800], italic: true },
  { family: 'Montserrat', category: 'sans-serif', weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Poppins', category: 'sans-serif', weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Lato', category: 'sans-serif', weights: [400, 700, 900], italic: true },
  { family: 'Oswald', category: 'sans-serif', weights: [400, 500, 600, 700], italic: false },
  { family: 'Raleway', category: 'sans-serif', weights: [400, 600, 700, 800], italic: true },
  { family: 'Nunito', category: 'sans-serif', weights: [400, 600, 700, 800], italic: false },
  { family: 'Work Sans', category: 'sans-serif', weights: [400, 500, 600, 700], italic: false },
  { family: 'DM Sans', category: 'sans-serif', weights: [400, 500, 700], italic: false },
  { family: 'Space Grotesk', category: 'sans-serif', weights: [400, 500, 700], italic: false },
  { family: 'Rubik', category: 'sans-serif', weights: [400, 500, 700, 900], italic: false },
  { family: 'Bebas Neue', category: 'display', weights: [400], italic: false },
  { family: 'Anton', category: 'sans-serif', weights: [400], italic: false },
  { family: 'Archivo Black', category: 'sans-serif', weights: [400], italic: false },
  { family: 'Playfair Display', category: 'serif', weights: [400, 700, 900], italic: true },
  { family: 'Merriweather', category: 'serif', weights: [400, 700, 900], italic: true },
  { family: 'Lora', category: 'serif', weights: [400, 500, 600, 700], italic: true },
  { family: 'DM Serif Display', category: 'serif', weights: [400], italic: true },
  { family: 'Abril Fatface', category: 'display', weights: [400], italic: false },
  { family: 'Lobster', category: 'display', weights: [400], italic: false },
  { family: 'Pacifico', category: 'handwriting', weights: [400], italic: false },
  { family: 'Dancing Script', category: 'handwriting', weights: [400, 700], italic: false },
  { family: 'Caveat', category: 'handwriting', weights: [400, 700], italic: false },
  { family: 'Permanent Marker', category: 'handwriting', weights: [400], italic: false },
  { family: 'Space Mono', category: 'monospace', weights: [400, 700], italic: true },
  { family: 'Cairo', category: 'sans-serif', weights: [400, 600, 700, 900], italic: false },
  { family: 'Tajawal', category: 'sans-serif', weights: [400, 500, 700, 900], italic: false },
  { family: 'Hind', category: 'sans-serif', weights: [400, 500, 600, 700], italic: false },
]

/**
 * The Google Fonts CSS that names a family's TrueType files. Without a browser's user agent,
 * Google answers with one static TTF per weight and style.
 */
export function googleCssUrl({ family, weights, italic }: GoogleFamily): string {
  const axes = italic
    ? `ital,wght@${[0, 1].flatMap((i) => weights.map((w) => `${i},${w}`)).join(';')}`
    : `wght@${weights.join(';')}`
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axes}`
}

/** The faces a Google Fonts stylesheet names: each one's weight, style and file URL. */
export function googleFaces(css: string): { weight: number; style: 'normal' | 'italic'; url: string }[] {
  const faces: { weight: number; style: 'normal' | 'italic'; url: string }[] = []
  for (const [block] of css.matchAll(/@font-face\s*{[^}]*}/g)) {
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1]
    const style = /font-style:\s*(normal|italic)/.exec(block)?.[1]
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(block)?.[1]
    if (weight && (style === 'normal' || style === 'italic') && url) faces.push({ weight: Number(weight), style, url })
  }
  return faces
}
