import { renderDesign, resourceCache, type ResourceBytes } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadFixtures } from './fixtures.ts'
import { comparePixels, fixtureResources } from './pixels.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()

const cases = loadFixtures().flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return Object.keys(parsed.design.pages).flatMap((pageId) =>
    Object.keys(parsed.design.formats).map((formatId) => ({ name, json, pageId, formatId })))
})

/** Counts what CanvasKit decodes and registers while `run` runs. */
function decodes(run: () => void) {
  const images = vi.spyOn(ck, 'MakeImageFromEncoded')
  const fonts = vi.spyOn(ck.TypefaceFontProvider, 'Make')
  run()
  const counts = { images: images.mock.calls.length, fontSets: fonts.mock.calls.length }
  images.mockRestore()
  fonts.mockRestore()
  return counts
}

describe('resource cache', () => {
  const cache = resourceCache(ck)
  afterEach(() => vi.restoreAllMocks())

  it.each(cases)('$name $pageId in $formatId renders the same pixels with and without the cache', ({ json, pageId, formatId }) => {
    const fresh = renderDesign(ck, json, pageId, formatId, bytes)
    const cached = renderDesign(ck, json, pageId, formatId, bytes, cache)
    expect(comparePixels(fresh, cached).differing).toBe(0)
  })

  it('decodes nothing for a second render of the same resources', () => {
    const [c] = cases
    if (!c) throw new Error('no cases')
    const own = resourceCache(ck)
    expect(decodes(() => renderDesign(ck, c.json, c.pageId, c.formatId, bytes, own))).toEqual({ images: Object.keys(bytes.images).length, fontSets: 1 })
    expect(decodes(() => renderDesign(ck, c.json, c.pageId, c.formatId, bytes, own))).toEqual({ images: 0, fontSets: 0 })
    own.delete()
  })

  it('decodes only the image whose bytes changed, and frees images no longer named', () => {
    const own = resourceCache(ck)
    own.resources(bytes)
    const [first, ...rest] = Object.keys(bytes.images)
    if (!first) throw new Error('no images')
    const changed: ResourceBytes = { ...bytes, images: { ...bytes.images, [first]: new Uint8Array(bytes.images[first] as Uint8Array) } }
    expect(decodes(() => own.resources(changed))).toEqual({ images: 1, fontSets: 0 })
    const fewer: ResourceBytes = { ...bytes, images: Object.fromEntries(rest.map((id) => [id, bytes.images[id] as Uint8Array])) }
    const resources = own.resources(fewer)
    expect([...resources.images.keys()].sort()).toEqual([...rest].sort())
    own.delete()
  })

  it('registers the fonts again only when the set of fonts changes', () => {
    const own = resourceCache(ck)
    own.resources(bytes)
    expect(decodes(() => own.resources({ ...bytes, fonts: [...bytes.fonts] }))).toEqual({ images: 0, fontSets: 0 })
    expect(decodes(() => own.resources({ ...bytes, fonts: bytes.fonts.slice(1) }))).toEqual({ images: 0, fontSets: 1 })
    own.delete()
  })

  it('refuses bytes CanvasKit cannot decode, and still works after', () => {
    const own = resourceCache(ck)
    expect(() => own.resources({ ...bytes, images: { broken: new Uint8Array([1, 2, 3]) } })).toThrow('asset "broken"')
    expect(own.resources(bytes).images.size).toBe(Object.keys(bytes.images).length)
    own.delete()
  })
})
