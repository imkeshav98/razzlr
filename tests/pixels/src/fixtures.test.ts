import { loadDesign, readDesign } from '@razzlr/doc'
import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES_DIR, loadFixtures } from './fixtures.ts'

const fixtures = loadFixtures()

describe('pixel fixtures', () => {
  it('are the spike spec\'s (#1) designs plus the layer bounds ones (#18, #31)', () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      'arabic-ad', 'carousel', 'english-sale-ad', 'groups-and-frames', 'hindi-ad', 'layer-bounds', 'shapes-and-effects', 'stress', 'text-and-group-bounds',
    ])
  })

  it.each(fixtures)('$name validates against the schema', ({ json }) => {
    const result = parseDesign(json)
    expect(result.success ? [] : result.errors).toEqual([])
  })

  it.each(fixtures)('$name survives a round trip through a design document', ({ json }) => {
    const result = parseDesign(json)
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(readDesign(loadDesign(result.design))).toEqual(result.design)
  })

  it('the carousel has three pages in two formats with format overrides', () => {
    const carousel = fixtures.find((f) => f.name === 'carousel')
    const result = parseDesign(carousel?.json)
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(Object.keys(result.design.pages)).toHaveLength(3)
    expect(Object.keys(result.design.formats)).toHaveLength(2)
    expect(Object.keys(result.design.overrides['format:pt'] ?? {})).not.toHaveLength(0)
  })

  it('the stress design has 300 layers', () => {
    const stress = fixtures.find((f) => f.name === 'stress')
    const result = parseDesign(stress?.json)
    if (!result.success) throw new Error(result.errors.join('\n'))
    expect(Object.keys(result.design.nodes)).toHaveLength(300)
  })

  it('the English sale ad nests its price in a group inside a clipping frame', () => {
    const ad = parseDesign(fixtures.find((f) => f.name === 'english-sale-ad')?.json)
    if (!ad.success) throw new Error(ad.errors.join('\n'))
    expect(ad.design.nodes['price-frame']?.type).toBe('frame')
    expect(ad.design.nodes['price-group']).toMatchObject({ type: 'group', parentId: 'price-frame' })
    expect(ad.design.nodes.price?.parentId).toBe('price-group')
  })

  it('an invalid fixture fails with readable errors', () => {
    const json = JSON.parse(readFileSync(join(FIXTURES_DIR, 'invalid', 'broken-parent-and-colour.json'), 'utf8'))
    expect(parseDesign(json)).toEqual({
      success: false,
      errors: [
        'nodes.box.props.fills.0.color: colours are #RRGGBBAA',
        'nodes.box.parentId: parent "missing-page" is neither a page nor a layer',
      ],
    })
  })
})
