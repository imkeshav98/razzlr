import { describe, expect, it } from 'vitest'
import { nameFromWebsite, needsWelcome, openingBrand, showsBrandList } from './home.ts'

const brand = (id: string) => ({ id, name: id })

describe('where the app opens (#84)', () => {
  it('opens a solo or company workspace with one brand on that brand', () => {
    expect(openingBrand('solo', [brand('a')])?.id).toBe('a')
    expect(openingBrand('company', [brand('a')])?.id).toBe('a')
    expect(showsBrandList('solo', [brand('a')])).toBe(false)
  })

  it('keeps the list for an agency, and for anyone with a second brand or none', () => {
    expect(openingBrand('agency', [brand('a')])).toBeNull()
    expect(openingBrand('company', [brand('a'), brand('b')])).toBeNull()
    expect(openingBrand('solo', [])).toBeNull()
    expect(showsBrandList('agency', [brand('a')])).toBe(true)
    expect(showsBrandList('company', [brand('a'), brand('b')])).toBe(true)
  })
})

describe('onboarding (#109)', () => {
  it('opens on onboarding until there is a brand', () => {
    expect(needsWelcome([])).toBe(true)
    expect(needsWelcome([brand('a')])).toBe(false)
  })

  it('names a brand from its website', () => {
    expect(nameFromWebsite('harbourcoffee.com')).toBe('Harbourcoffee')
    expect(nameFromWebsite('https://www.harbour-coffee.com/menu?x=1')).toBe('Harbour Coffee')
    expect(nameFromWebsite('northline-cycles.co.uk')).toBe('Northline Cycles')
    expect(nameFromWebsite('http://shop.kite_studio.io')).toBe('Kite Studio')
    expect(nameFromWebsite('localhost')).toBe('Localhost')
    expect(nameFromWebsite('')).toBeNull()
    expect(nameFromWebsite('not a site at all')).toBeNull()
  })
})
