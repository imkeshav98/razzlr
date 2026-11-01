import { parseDesign } from '@dazbee/schema'
import type { CanvasKit, Surface } from '@dazbee/canvaskit'
import { drawScene, type Resources } from './draw.ts'
import { resourceCache, type ResourceBytes, type ResourceCache } from './resources.ts'
import { render, type Scene } from './scene.ts'
import { textMeasure } from './text.ts'
import { drawVectorPage, type VectorTarget } from './vector.ts'

export interface Rendered {
  width: number
  height: number
  /** RGBA, 8 bits a channel, not premultiplied, row by row. */
  pixels: Uint8Array
  png: Uint8Array
}

/**
 * Builds the scene and hands it to `draw` with the cache's resources, or with ones made for this
 * draw and freed after it. A long-lived process passes one cache to every render so fonts and
 * images are decoded once. Auto layout measures text with the same fonts the draw uses (#46).
 */
function withScene<T>(
  ck: CanvasKit, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, cache: ResourceCache | undefined,
  draw: (scene: Scene, resources: Resources) => T,
): T {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const owned = cache ?? resourceCache(ck)
  try {
    const resources = owned.resources(bytes)
    const scene = render(parsed.design, pageId, formatId, undefined, textMeasure(ck, resources), bytes.variables)
    return draw(scene, resources)
  } finally {
    if (!cache) owned.delete()
  }
}

function drawOn(ck: CanvasKit, surface: Surface, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache): Scene {
  return withScene(ck, json, pageId, formatId, bytes, cache, (scene, resources) => {
    drawScene(ck, surface.getCanvas(), scene, resources)
    surface.flush()
    return scene
  })
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

/** What a PDF says about itself. */
export interface VectorOptions {
  /** The PDF's title, such as the design's name. */
  title?: string
  /** The language of its text, such as `en` or `ar`. */
  lang?: string
}

/**
 * The render seam for vector exports: design JSON in, a one-page PDF or an SVG out, drawn by the
 * same code as the pixels onto Skia's PDF or SVG canvas, in Node and in the browser alike. A unit
 * is one pixel of the format, and what the file can't hold as vectors is drawn at that resolution
 * (see drawVectorPage). PDF text stays text with its fonts embedded; SVG text is drawn as shapes,
 * because an SVG names fonts the app that opens it may not have and shapes Hindi and Arabic itself.
 */
export function renderVector(
  ck: CanvasKit, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, target: VectorTarget,
  cache?: ResourceCache, options: VectorOptions = {},
): Uint8Array {
  return withScene(ck, json, pageId, formatId, bytes, cache, (scene, resources) => {
    if (target === 'pdf') {
      const pdf = new ck.PDFDocument({
        title: options.title ?? '', author: '', creator: '', producer: '', lang: options.lang ?? '',
        // One raster pixel to a unit: blurs and shadows come at the export's own resolution.
        rasterDPI: 72, encodingQuality: 101,
      })
      try {
        const canvas = pdf.beginPage(scene.width, scene.height)
        if (!canvas) throw new Error('CanvasKit could not start a PDF page')
        drawVectorPage(ck, canvas, scene, resources, 'pdf')
        pdf.endPage()
        const file = pdf.close()
        if (!file) throw new Error('CanvasKit could not finish the PDF')
        return file
      } finally {
        pdf.delete()
      }
    }
    const svg = new ck.SVGDocument(scene.width, scene.height, ck.SVG_CONVERT_TEXT_TO_PATHS | ck.SVG_NO_PRETTY_XML)
    try {
      const canvas = svg.canvas()
      if (!canvas) throw new Error('CanvasKit could not start an SVG')
      drawVectorPage(ck, canvas, scene, resources, 'svg')
      const file = svg.close()
      if (!file) throw new Error('CanvasKit could not finish the SVG')
      return numberClips(file)
    } finally {
      svg.delete()
    }
  })
}

/**
 * Skia names an SVG's clip paths after its clips' ids, which count up across the whole process, so
 * the same page would come out different after other exports. Renumbered in order of appearance,
 * the file depends on the page alone, in every runtime.
 */
function numberClips(file: Uint8Array): Uint8Array {
  const ids = new Map<string, string>()
  const text = new TextDecoder().decode(file).replace(/\bcl_[0-9a-f]+\b/g, (id) => {
    if (!ids.has(id)) ids.set(id, `cl_${ids.size + 1}`)
    return ids.get(id) as string
  })
  return new TextEncoder().encode(text)
}
