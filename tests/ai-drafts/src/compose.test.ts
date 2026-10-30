import { parseDesign } from '@razzlr/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { contrast, draw, fitText, loadKit, missingChars, withoutText, type Kit } from './draw.ts'
import { brandFamilies, scriptsOf } from './fonts.ts'
import { compose, type Layout, type LayoutLayer } from './layout.ts'

let kit: Kit
beforeAll(async () => { kit = await loadKit() })

const text = (over: Partial<Extract<LayoutLayer, { type: 'text' }>>): LayoutLayer => ({
  type: 'text', role: 'headline', textIndex: 0, text: 'Big sale', box: { x: 60, y: 60, w: 960, h: 200 },
  family: 'Poppins', weight: 800, size: 96, color: '#FFFFFF', align: 'start', lineHeight: null, letterSpacing: null, shadow: false,
  ...over,
})

const layout: Layout = {
  layers: [
    { type: 'rect', name: 'Card', box: { x: 40, y: 700, w: 500, h: 300 }, color: '#1B5E20', radius: 24, opacity: 1 },
    { type: 'scrim', box: { x: 0, y: 0, w: 1080, h: 400 }, color: '#000000', from: 'top', opacity: 0.6 },
    text({}),
    text({ textIndex: 1, role: 'price', text: 'सिर्फ़ ₹1,299', family: 'Mukta', weight: 800, box: { x: 60, y: 720, w: 460, h: 120 }, size: 72 }),
    text({ textIndex: 2, role: 'cta', text: 'تسوق الآن', family: 'Tajawal', weight: 700, box: { x: 60, y: 860, w: 460, h: 100 }, size: 56, align: 'end' }),
  ],
}

describe('compose', () => {
  it('makes a design our schema accepts, with every layer in order', () => {
    const design = compose({ id: 'test', width: 1080, height: 1080, background: '#C0C0C0', layout })
    const parsed = parseDesign(design)
    expect(parsed.success && Object.keys(parsed.design.nodes)).toEqual(['rect0', 'scrim1', 'text2', 'text3', 'text4'])
  })

  it('draws Latin, Devanagari and Arabic texts in the brand fonts with no missing glyphs', () => {
    const { fits } = fitText(kit, compose({ id: 'test', width: 1080, height: 1080, layout }))
    expect(fits.map((f) => f.missing)).toEqual([[], [], []])
  })
})

describe('fitText', () => {
  it('leaves a text that fits alone', () => {
    const { fits } = fitText(kit, compose({ id: 'test', width: 1080, height: 1080, layout: { layers: [text({})] } }))
    expect(fits[0]).toMatchObject({ scale: 1, overflows: false })
  })

  it('shrinks a text too long for its box until it fits', () => {
    const long = text({ text: 'Everything in the summer collection, half price this weekend only', box: { x: 60, y: 60, w: 600, h: 320 } })
    const { design, fits } = fitText(kit, compose({ id: 'test', width: 1080, height: 1080, layout: { layers: [long] } }))
    expect(fits[0]?.scale).toBeLessThan(0.8)
    expect(fits[0]?.overflows).toBe(false)
    const node = design.nodes.text0
    expect(node?.type === 'text' && node.props.style.fontSize).toBeLessThan(96 * 0.8)
  })

  it('reports overflow when half the size still does not fit', () => {
    const tiny = text({ text: 'Everything in the summer collection, half price', box: { x: 60, y: 60, w: 200, h: 40 } })
    expect(fitText(kit, compose({ id: 'test', width: 1080, height: 1080, layout: { layers: [tiny] } })).fits[0]?.overflows).toBe(true)
  })
})

describe('fonts', () => {
  it('knows which scripts each brand family draws', () => {
    const families = brandFamilies(kit.ck, kit.fonts)
    const scripts = (name: string) => families.find((f) => f.family === name)?.scripts
    expect(scripts('Bebas Neue')).toEqual(['latin'])
    expect(scripts('Mukta')).toEqual(['latin', 'devanagari'])
    expect(scripts('Tajawal')).toEqual(['latin', 'arabic'])
    expect(families.find((f) => f.family === 'Poppins')?.weights).toEqual([400, 600, 700, 800])
  })

  it('finds the characters a family lacks', () => {
    expect(missingChars(kit, 'Bebas Neue', 'सेल 50%')).toEqual(['स', 'े', 'ल'])
    expect(scriptsOf('Flat 50% छूट خصم')).toEqual(['latin', 'devanagari', 'arabic'])
  })
})

describe('contrast', () => {
  it('measures white text on a dark card as readable and on white as not', () => {
    const design = compose({ id: 'test', width: 1080, height: 1080, background: '#FFFFFF', layout })
    const back = draw(kit, withoutText(design), {})
    const onCard = contrast(back, { x: 60, y: 720, width: 460, height: 120 }, '#FFFFFF')
    const onWhite = contrast(back, { x: 600, y: 500, width: 400, height: 100 }, '#FFFFFF')
    expect(onCard.median).toBeGreaterThan(7)
    expect(onCard.under3).toBe(0)
    expect(onWhite.median).toBeCloseTo(1, 1)
  })
})
