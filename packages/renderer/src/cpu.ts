import { parseDesign } from '@razzlr/schema'
import type { CanvasKit } from 'canvaskit-wasm'
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

/**
 * The render seam: design JSON in, pixels and PNG out, drawn on the CPU surface.
 * Every export goes through here, in Node and in the browser alike (ADR-0005).
 */
export function renderOnCpu(ck: CanvasKit, json: unknown, pageId: string, formatId: string, bytes: ResourceBytes): Rendered {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const scene = render(parsed.design, pageId, formatId)
  const surface = ck.MakeSurface(scene.width, scene.height)
  if (!surface) throw new Error(`CanvasKit could not make a ${scene.width}×${scene.height} CPU surface`)
  const resources = makeResources(ck, bytes)
  try {
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
    resources.delete()
    surface.delete()
  }
}
