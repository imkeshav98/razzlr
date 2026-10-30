import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FALLBACK_FAMILY } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import type { ResourceBytes } from '@razzlr/renderer'
import type { CanvasKit } from 'canvaskit-wasm'

export const ASSETS_DIR = join(import.meta.dirname, '..', 'assets')
export const REFERENCE_DIR = join(import.meta.dirname, '..', 'reference')
export const OUTPUT_DIR = join(import.meta.dirname, '..', 'output')

/** The shipped fonts and every fixture image, as bytes. */
export function fixtureResources(): ResourceBytes {
  const images = Object.fromEntries(readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.jpg'))
    .map((f) => [f.replace(/\.jpg$/, ''), new Uint8Array(readFileSync(join(ASSETS_DIR, f)))]))
  return { fonts: loadFontFiles(), fallbackFamilies: [FALLBACK_FAMILY], images }
}

export interface Pixels { width: number; height: number; pixels: Uint8Array }

/** Decodes a PNG to unpremultiplied RGBA with CanvasKit. */
export function decodePng(ck: CanvasKit, png: Uint8Array): Pixels {
  const image = ck.MakeImageFromEncoded(png)
  if (!image) throw new Error('not a PNG CanvasKit can read')
  const width = image.width()
  const height = image.height()
  const pixels = image.readPixels(0, 0, {
    width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
  })
  image.delete()
  if (!(pixels instanceof Uint8Array)) throw new Error('could not read the PNG pixels')
  return { width, height, pixels }
}

export function encodePng(ck: CanvasKit, { width, height, pixels }: Pixels): Uint8Array {
  const image = ck.MakeImage({
    width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
  }, pixels, width * 4)
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('could not encode a PNG')
  return png
}

/**
 * Counts pixels that differ in any channel. The diff image shows the expected image faded,
 * with every differing pixel in solid magenta.
 */
export function comparePixels(expected: Pixels, actual: Pixels): { differing: number; diff: Pixels } {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`size ${actual.width}×${actual.height} differs from the reference ${expected.width}×${expected.height}`)
  }
  const diff = new Uint8Array(expected.pixels.length)
  let differing = 0
  for (let i = 0; i < diff.length; i += 4) {
    const same = expected.pixels[i] === actual.pixels[i] && expected.pixels[i + 1] === actual.pixels[i + 1]
      && expected.pixels[i + 2] === actual.pixels[i + 2] && expected.pixels[i + 3] === actual.pixels[i + 3]
    if (same) {
      const grey = 255 - Math.round((255 - ((expected.pixels[i] ?? 0) + (expected.pixels[i + 1] ?? 0) + (expected.pixels[i + 2] ?? 0)) / 3) / 4)
      diff.set([grey, grey, grey, 255], i)
    } else {
      differing++
      diff.set([255, 0, 255, 255], i)
    }
  }
  return { differing, diff: { width: expected.width, height: expected.height, pixels: diff } }
}
