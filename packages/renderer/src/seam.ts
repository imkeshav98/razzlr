import { parseDesign } from '@razzlr/schema'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import { drawScene } from './draw.ts'
import { resourceCache, type ResourceBytes, type ResourceCache } from './resources.ts'
import { render, type Scene } from './scene.ts'
import { textMeasure } from './text.ts'

export interface Rendered {
  width: number
  height: number
  /** RGBA, 8 bits a channel, not premultiplied, row by row. */
  pixels: Uint8Array
  png: Uint8Array
}

/**
 * Builds the scene and draws it with the cache's resources, or with ones made for this draw and
 * freed after it. A long-lived process passes one cache to every render so fonts and images are
 * decoded once. Auto layout measures text with the same fonts the draw uses (#46).
 */
function drawOn(ck: CanvasKit, surface: Surface, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache): Scene {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const owned = cache ?? resourceCache(ck)
  try {
    const resources = owned.resources(bytes)
    const scene = render(parsed.design, pageId, formatId, undefined, textMeasure(ck, resources), bytes.variables)
    drawScene(ck, surface.getCanvas(), scene, resources)
    surface.flush()
    return scene
  } finally {
    if (!cache) owned.delete()
  }
}

/**
 * Draws one page in one format onto a surface the caller owns, such as the editor's WebGL
 * surface. Returns the page size.
 */
export function drawDesign(
  ck: CanvasKit, surface: Surface, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache,
): { width: number; height: number } {
  const scene = drawOn(ck, surface, json, pageId, formatId, bytes, cache)
  return { width: scene.width, height: scene.height }
}

/** Reads a surface back as unpremultiplied RGBA and a PNG. */
function readSurface(ck: CanvasKit, surface: Surface, width: number, height: number): Rendered {
  const image = surface.makeImageSnapshot()
  try {
    const pixels = image.readPixels(0, 0, {
      width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
    })
    const png = image.encodeToBytes()
    if (!(pixels instanceof Uint8Array) || !png) throw new Error('CanvasKit could not read back the rendered pixels')
    return { width, height, pixels, png }
  } finally {
    image.delete()
  }
}

/**
 * The render seam for exports: design JSON in, pixels and PNG out, always on the CPU surface
 * (ADR-0005), in Node and in the browser alike.
 */
export function renderDesign(
  ck: CanvasKit, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache,
): Rendered {
  const parsed = parseDesign(json)
  const format = parsed.success ? parsed.design.formats[formatId] : undefined
  // A bad design or format is reported by the draw, which parses and renders it.
  const { width, height } = format ?? { width: 1, height: 1 }
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error(`CanvasKit could not make a ${width}×${height} CPU surface`)
  try {
    drawOn(ck, surface, parsed.success ? parsed.design : json, pageId, formatId, bytes, cache)
    return readSurface(ck, surface, width, height)
  } finally {
    // delete() alone keeps the w×h×4 pixel buffer in wasm memory; dispose() frees both.
    surface.dispose()
  }
}
