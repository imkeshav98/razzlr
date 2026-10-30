// Ranges and style keys inside text (#47), on English, Hindi and Arabic.
import { TextProps } from '@razzlr/schema'
import { describe, expect, it } from 'vitest'
import { paragraphAt, step, toggled, wordAt } from './text-edit.ts'

const props = (text: string, runs: unknown[] = [], weight = 400) => TextProps.parse({
  x: 0, y: 0, width: 100, height: 20, text, runs, style: { fontFamily: 'Noto Sans', fontSize: 16, fontWeight: weight, color: '#000000FF' },
})

describe('text editing', () => {
  it('steps a grapheme at a time, a Devanagari conjunct whole', () => {
    const text = 'क्ष a'
    expect(step(text, 0, true)).toBe(3)
    expect(step(text, 3, false)).toBe(0)
    expect(step(text, text.length, true)).toBe(text.length)
    expect(step(text, 0, false)).toBe(0)
  })

  it('double click selects the word under it, in any script', () => {
    const text = 'Big summer sale'
    expect(wordAt(text, 5)).toEqual({ start: 4, end: 10 })
    // At a word's end it is still that word.
    expect(wordAt(text, 10)).toEqual({ start: 4, end: 10 })
    expect(wordAt('خصم اليوم', 6)).toEqual({ start: 4, end: 9 })
    expect(wordAt('श्री क्षेत्र', 6)).toEqual({ start: 5, end: 12 })
    // Between words, the space.
    expect(wordAt('a  b', 2)).toEqual({ start: 1, end: 3 })
  })

  it('triple click selects the paragraph', () => {
    const text = 'One\nTwo three\nFour'
    expect(paragraphAt(text, 6)).toEqual({ start: 4, end: 13 })
    expect(paragraphAt(text, 0)).toEqual({ start: 0, end: 3 })
    expect(paragraphAt(text, text.length)).toEqual({ start: 14, end: 18 })
  })

  it('a style key turns a style on over the range unless it is on throughout, then off', () => {
    const plain = props('Buy now')
    expect(toggled(plain, { start: 0, end: 3 }, 'bold')).toEqual({ fontWeight: 700 })
    const partly = props('Buy now', [{ start: 0, end: 2, style: { fontWeight: 700 } }])
    expect(toggled(partly, { start: 0, end: 3 }, 'bold')).toEqual({ fontWeight: 700 })
    const bold = props('Buy now', [{ start: 0, end: 3, style: { fontWeight: 700 } }])
    expect(toggled(bold, { start: 0, end: 3 }, 'bold')).toEqual({ fontWeight: 400 })
    // Bold text made not bold goes to the regular weight.
    expect(toggled(props('Buy', [], 800), { start: 0, end: 3 }, 'bold')).toEqual({ fontWeight: 400 })
    expect(toggled(plain, { start: 0, end: 3 }, 'italic')).toEqual({ fontStyle: 'italic' })
    expect(toggled(plain, { start: 0, end: 3 }, 'underline')).toEqual({ underline: true })
    const struck = props('Buy now', [{ start: 0, end: 7, style: { strikethrough: true } }])
    expect(toggled(struck, { start: 2, end: 5 }, 'strikethrough')).toEqual({ strikethrough: false })
  })
})
