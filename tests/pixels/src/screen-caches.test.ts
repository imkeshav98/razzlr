// The editor keeps laid-out text and recorded layers between redraws (#36); drawing from those caches must not change a pixel.
import { drawScene, layerPictures, paragraphCache, render, renderDesign, resourceCache, sceneMemo, textMeasure } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { parseDesign } from '@dazbee/schema'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { loadFixtures } from './fixtures.ts'
import { comparePixels, fixtureResources } from './pixels.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = resourceCache(ck)
const resources = cache.resources(bytes)
const paragraphs = paragraphCache()
const layers = layerPictures()
const scenes = sceneMemo()
/** Auto layout measures text as the editor does (#46). */
const measure = textMeasure(ck, resources)
afterAll(() => {
  layers.delete()
  paragraphs.delete()
  cache.delete()
})

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const { design } = parsed
  return Object.keys(design.pages).flatMap((pageId) => Object.keys(design.formats).map((formatId) => ({ name, json, design, pageId, formatId })))
})

/** Draws a scene with the shared paragraph and layer caches on a CPU surface and reads it back. */
function drawCached(scene: ReturnType<typeof render>) {
  const surface = ck.MakeSurface(scene.width, scene.height)
  if (!surface) throw new Error('no surface')
  try {
    drawScene(ck, surface.getCanvas(), scene, { ...resources, paragraphs, layers })
    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, { width: scene.width, height: scene.height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB })
    image.delete()
    if (!(pixels instanceof Uint8Array)) throw new Error('no pixels')
    return { width: scene.width, height: scene.height, pixels }
  } finally {
    surface.dispose()
  }
}

describe('paragraph and layer caches', () => {
  it.each(cases)('$name $pageId in $formatId draws the same pixels from the cache, the second time without laying out or recording', ({ json, design, pageId, formatId }) => {
    const expected = renderDesign(ck, json, pageId, formatId, bytes, cache)
    expect(comparePixels(expected, drawCached(render(design, pageId, formatId, scenes, measure))).differing).toBe(0)
    const builds = vi.spyOn(ck.ParagraphBuilder, 'MakeFromFontCollection')
    const recorders = vi.spyOn(ck, 'PictureRecorder')
    expect(comparePixels(expected, drawCached(render(design, pageId, formatId, scenes, measure))).differing).toBe(0)
    expect(builds).not.toHaveBeenCalled()
    expect(recorders).not.toHaveBeenCalled()
    builds.mockRestore()
    recorders.mockRestore()
  })
})
