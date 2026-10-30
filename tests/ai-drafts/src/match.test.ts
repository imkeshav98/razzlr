import { describe, expect, it } from 'vitest'
import { matchTexts, normalize } from './match.ts'

describe('normalize', () => {
  it('ignores spacing, line breaks and Latin case', () => {
    expect(normalize('  Shop\nNOW ')).toBe(normalize('Shop now'))
  })
  it('keeps digits, separators and currency', () => {
    expect(normalize('₹1,299')).not.toBe(normalize('₹1299'))
    expect(normalize('₹1,299')).not.toBe(normalize('Rs 1,299'))
  })
  it('keeps Devanagari marks, so a missing matra fails', () => {
    expect(normalize('दिवाली')).not.toBe(normalize('दिवालि'))
    expect(normalize('ज़्यादा')).not.toBe(normalize('ज्यादा'))
  })
  it('keeps Arabic dots and drops only the tatweel', () => {
    expect(normalize('خصم')).not.toBe(normalize('حصم'))
    expect(normalize('خـصـم')).toBe(normalize('خصم'))
  })
  it('treats curly and straight quotes and dashes alike', () => {
    expect(normalize('Kid’s – Wear')).toBe(normalize("Kid's - Wear"))
  })
})

describe('matchTexts', () => {
  it('finds every intended text, one per block', () => {
    expect(matchTexts(['Big sale', 'Shop now'], ['SHOP NOW', 'Big Sale'])).toEqual({ found: [true, true], stray: [] })
  })
  it('finds two intended texts a reader grouped into one block', () => {
    expect(matchTexts(['Flat 50% off', 'Code DIWALI50'], ['Flat 50% off | Code DIWALI50'])).toEqual({ found: [true, true], stray: [] })
  })
  it('fails a misspelt text and reports what was read as stray', () => {
    const m = matchTexts(['Limited edition'], ['Limted edition'])
    expect(m.found).toEqual([false])
    expect(m.stray).toEqual(['limted edition'])
  })
  it('reports invented copy as stray', () => {
    expect(matchTexts(['Shop now'], ['Shop now', 'Free shipping']).stray).toEqual(['free shipping'])
  })
  it('does not find a text inside a longer word', () => {
    expect(matchTexts(['50% off'], ['150% off']).found).toEqual([false])
  })
  it('does not find a Hindi word whose last letter carries an extra mark', () => {
    expect(matchTexts(['सेल'], ['सेलो']).found).toEqual([false])
  })
  it('uses each seen block only once for two equal intended texts', () => {
    expect(matchTexts(['Sale', 'Sale'], ['Sale']).found).toEqual([true, false])
  })
})
