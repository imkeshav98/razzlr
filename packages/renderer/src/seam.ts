import { parseDesign } from '@razzlr/schema'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import { drawScene } from './draw.ts'
import { makeResources, type ResourceBytes } from './resources.ts'
import { render } from './scene.ts'

export interface Rendered {
  width: number
  height: number
  /** RGBA, 8 bits a channel, not premultiplied, row by row. */
  pixels: Uint8Array
  png: Uint8Array
}

/** Makes the surface to draw on. The browser passes one that makes a WebGL surface. */
export type SurfaceMaker = (ck: CanvasKit, width: number, height: number) => Surface | null

/** The CPU surface: the only one exports may use (ADR-0005). */
export const cpuSurface: SurfaceMaker = (ck, width, height) => ck.MakeSurface(width, height)

/**
 * The render seam: design JSON in, pixels and PNG out, on the surface asked for.
 * Exports always use `cpuSurface`; a WebGL render is for the screen, and is only read back
 * here to measure how far the screen drifts from the export.
 */
export function renderDesign(
  ck: CanvasKit, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes, makeSurface: SurfaceMaker = cpuSurface,
): Rendered {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const scene = render(parsed.design, pageId, formatId)
  const surface = makeSurface(ck, scene.width, scene.height)
  if (!surface) throw new Error(`CanvasKit could not make a ${scene.width}×${scene.height} surface`)
  let resources: ReturnType<typeof makeResources> | undefined
  try {
    resources = makeResources(ck, bytes)
    drawScene(ck, surface.getCanvas(), scene, resources)
    surface.flush()
    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, {
      width: scene.width, height: scene.height,
      colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
    })
    const png = image.encodeToBytes()
    image.delete()
    if (!(pixels instanceof Uint8Array) || !png) throw new Error('CanvasKit could not read back the rendered pixels')
    return { width: scene.width, height: scene.height, pixels, png }
  } finally {
    resources?.delete()
    surface.delete()
  }
}
