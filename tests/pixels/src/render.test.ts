import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { loadFixtures } from './fixtures.ts'
import { comparePixels, decodePng, encodePng, fixtureResources, OUTPUT_DIR, REFERENCE_DIR } from './pixels.ts'

/** Fixtures with committed reference images. Carousel and stress have parity checks only. */
const CHECKED = ['arabic-ad', 'english-sale-ad', 'groups-and-frames', 'hindi-ad', 'layer-bounds', 'shapes-and-effects', 'strokes-and-effects', 'text-and-group-bounds']
/** Set to rewrite the reference images from the current renderer, after checking the output by eye. */
const UPDATE = process.env.UPDATE_REFERENCES === '1'
if (UPDATE && process.env.CI) throw new Error('UPDATE_REFERENCES rewrites the references, so CI must never set it')

const ck = await loadCanvasKit()
const resources = fixtureResources()

const cases = loadFixtures().filter((f) => CHECKED.includes(f.name)).flatMap(({ name, json }) => {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const { pages, formats } = parsed.design
  return Object.keys(pages).flatMap((pageId) => Object.keys(formats).map((formatId) => ({ name, json, pageId, formatId })))
})

describe('Node CPU render', () => {
  it('covers every page and format of the checked fixtures', () => {
    expect(cases.map((c) => `${c.name}/${c.pageId}.${c.formatId}`)).toEqual(['arabic-ad/p1.sq', 'english-sale-ad/p1.sq', 'groups-and-frames/p1.sq', 'hindi-ad/p1.sq', 'layer-bounds/p1.sq', 'shapes-and-effects/p1.sq', 'strokes-and-effects/p1.sq', 'text-and-group-bounds/p1.sq'])
  })

  it.each(cases)('$name $pageId in $formatId matches its reference image', ({ name, json, pageId, formatId }) => {
    const file = `${pageId}.${formatId}.png`
    const reference = join(REFERENCE_DIR, name, file)
    const out = join(OUTPUT_DIR, name)
    rmSync(join(out, file.replace('.png', '.actual.png')), { force: true })
    rmSync(join(out, file.replace('.png', '.diff.png')), { force: true })

    const rendered = renderDesign(ck, json, pageId, formatId, resources)
    if (UPDATE) {
      mkdirSync(join(REFERENCE_DIR, name), { recursive: true })
      writeFileSync(reference, rendered.png)
      return
    }
    if (!existsSync(reference)) throw new Error(`no reference image ${reference}; run with UPDATE_REFERENCES=1 and check it by eye`)

    const { differing, diff } = comparePixels(decodePng(ck, new Uint8Array(readFileSync(reference))), rendered)
    if (differing > 0) {
      mkdirSync(out, { recursive: true })
      writeFileSync(join(out, file.replace('.png', '.actual.png')), rendered.png)
      writeFileSync(join(out, file.replace('.png', '.diff.png')), encodePng(ck, diff))
    }
    expect(differing, `differing pixels; see ${out}`).toBe(0)
  })

  it('renders the same pixels twice in a row', () => {
    const [first] = cases
    if (!first) throw new Error('no cases')
    const a = renderDesign(ck, first.json, first.pageId, first.formatId, resources)
    const b = renderDesign(ck, first.json, first.pageId, first.formatId, resources)
    expect(comparePixels(a, b).differing).toBe(0)
  })
})

describe('comparePixels', () => {
  const px = (...values: number[]) => ({ width: values.length / 4, height: 1, pixels: new Uint8Array(values) })

  it('counts a pixel that differs in any one channel', () => {
    expect(comparePixels(px(1, 2, 3, 255, 9, 9, 9, 255), px(1, 2, 3, 254, 9, 9, 9, 255)).differing).toBe(1)
  })

  it('marks differing pixels magenta in the diff image', () => {
    const { diff } = comparePixels(px(0, 0, 0, 255, 0, 0, 0, 255), px(0, 0, 0, 255, 1, 0, 0, 255))
    expect([...diff.pixels.subarray(4)]).toEqual([255, 0, 255, 255])
  })

  it('refuses images of different sizes', () => {
    expect(() => comparePixels(px(0, 0, 0, 0), px(0, 0, 0, 0, 0, 0, 0, 0))).toThrow('differs from the reference')
  })
})
