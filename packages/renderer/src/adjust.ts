// An image fill's adjustments and filter (#48) as one colour matrix: the adjustments in their
// order, then the filter. Each slider runs -100…100 and 0 leaves the image as it is. The matrix is
// Skia's: four rows of five, red, green, blue and alpha out, the last column added in 0…1 units.
import type { ImageAdjust, ImageFilter } from '@dazbee/schema'

export type ColorMatrix = number[]

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
// Rec. 709 luma, as the sRGB primaries weigh.
const LUMA = [0.2126, 0.7152, 0.0722] as const

/** `a` after `b`: the matrix that does `b`, then `a`. */
export function after(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: number[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = col === 4 ? (a[row * 5 + 4] ?? 0) : 0
      for (let k = 0; k < 4; k++) sum += (a[row * 5 + k] ?? 0) * (b[k * 5 + col] ?? 0)
      out.push(sum)
    }
  }
  return out
}

/** Red, green and blue each times its own factor, then plus its own amount. */
const channels = (r: number, g: number, b: number, add = 0): ColorMatrix => [r, 0, 0, 0, add, 0, g, 0, 0, add, 0, 0, b, 0, add, 0, 0, 0, 1, 0]

/** Saturation `s`: 0 is grey at the same luma, 1 the image, more is more vivid. */
function saturation(s: number): ColorMatrix {
  const [lr, lg, lb] = LUMA
  return [
    lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), 0, 0,
    lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), 0, 0,
    lr * (1 - s), lg * (1 - s), lb * (1 - s) + s, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

/** Contrast `c` about mid grey: 0 is flat grey, 1 the image. */
const contrast = (c: number) => channels(c, c, c, 0.5 * (1 - c))
/** Warmer (`t` > 0) is more red and less blue; cooler the other way. */
const temperature = (t: number) => channels(1 + 0.2 * t, 1, 1 - 0.2 * t)

const SEPIA: ColorMatrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
]

const FILTERS: Record<ImageFilter, ColorMatrix> = {
  none: IDENTITY,
  mono: saturation(0),
  sepia: SEPIA,
  vivid: after(contrast(1.1), saturation(1.4)),
  // Flatter and lifted: blacks become a soft grey.
  fade: after(channels(0.82, 0.82, 0.82, 0.1), saturation(0.75)),
  warm: temperature(0.4),
  cool: temperature(-0.4),
}

/**
 * The colour matrix for an image fill's adjustments, then its filter, or null when it leaves the
 * image as it is. Exposure is ±1 stop, contrast and saturation run from none to double, and
 * temperature and tint shift red against blue and green against magenta by up to a fifth.
 */
export function imageColorMatrix(adjust: ImageAdjust | undefined, filter: ImageFilter | undefined): ColorMatrix | null {
  const steps: ColorMatrix[] = []
  if (adjust) {
    const { exposure, contrast: c, saturation: s, temperature: t, tint } = adjust
    if (exposure) steps.push(channels(2 ** (exposure / 100), 2 ** (exposure / 100), 2 ** (exposure / 100)))
    if (c) steps.push(contrast(1 + c / 100))
    if (s) steps.push(saturation(1 + s / 100))
    if (t) steps.push(temperature(t / 100))
    if (tint) steps.push(channels(1, 1 - 0.2 * (tint / 100), 1))
  }
  if (filter && filter !== 'none') steps.push(FILTERS[filter])
  if (steps.length === 0) return null
  return steps.reduce((done, next) => after(next, done))
}

/** Alpha from luma, for a luminance mask drawn over black: bright shows, dark hides. */
export const LUMA_TO_ALPHA: ColorMatrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...LUMA, 0, 0]
