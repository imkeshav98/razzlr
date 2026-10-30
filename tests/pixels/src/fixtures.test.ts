import { parseDesign } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { loadFixtures } from './fixtures.ts'

const fixtures = loadFixtures()

describe('pixel fixtures', () => {
  it('are the six designs proposal 3 asks for', () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      'arabic-ad', 'carousel', 'english-sale-ad', 'hindi-ad', 'shapes-and-effects', 'stress',
    ])
  })

  it.each(fixtures)('$name validates against the schema', ({ json }) => {
    const result = parseDesign(json)
    expect(result.success ? [] : result.errors).toEqual([])
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
})
