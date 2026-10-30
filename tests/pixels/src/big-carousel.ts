import type { DesignInput } from '@razzlr/schema'

/** The five formats a carousel campaign typically ships in, primary first. */
const FORMATS = {
  sq: { name: 'Square 1:1', width: 1080, height: 1080 },
  pt: { name: 'Portrait 4:5', width: 1080, height: 1350 },
  story: { name: 'Story 9:16', width: 1080, height: 1920 },
  land: { name: 'Landscape 1.91:1', width: 1200, height: 628 },
  mpu: { name: 'MPU 300×250', width: 300, height: 250 },
} as const

const order = (i: number) => `a${i.toString(36)}`

/**
 * A 20-card carousel in 5 formats, for the spike's document size and server render checks (#10):
 * each card has a photo, a gradient band, a kicker, a title, a body and a button, and every
 * non-primary format overrides the layout of every layer, as an agency carousel would.
 */
export function bigCarousel(cards = 20): DesignInput {
  const formats = Object.fromEntries(Object.entries(FORMATS).map(([id, f], i) => [id, { ...f, order: order(i) }]))
  const pages: DesignInput['pages'] = {}
  const nodes: DesignInput['nodes'] = {}
  const overrides: Record<string, Record<string, Record<string, unknown>>> = {}
  for (let c = 1; c <= cards; c++) {
    const p = `p${c}`
    pages[p] = { name: `Card ${c}`, order: order(c), fills: [{ type: 'solid', color: '#ECEFF1FF' }] }
    const text = (fontSize: number, color: string, fontWeight = 400) => ({ fontFamily: 'Noto Sans', fontSize, color, fontWeight })
    const layers: Record<string, DesignInput['nodes'][string]> = {
      photo: { type: 'graphic', parentId: p, index: 'a0', name: 'Photo', role: 'product', props: { x: 0, y: 0, width: 1080, height: 700, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: `card-${((c - 1) % 3) + 1}`, fit: 'fill' }] } },
      band: { type: 'graphic', parentId: p, index: 'a1', name: 'Band', props: { x: 0, y: 560, width: 1080, height: 140, shape: { kind: 'rect' }, fills: [{ type: 'linear', from: { x: 0, y: 0 }, to: { x: 0, y: 1 }, stops: [{ offset: 0, color: '#26323800' }, { offset: 1, color: '#263238CC' }] }] } },
      kicker: { type: 'text', parentId: p, index: 'a2', name: 'Kicker', props: { x: 60, y: 740, width: 960, height: 60, text: `Step ${c} of ${cards}`, style: text(40, '#607D8BFF', 700) } },
      title: { type: 'text', parentId: p, index: 'a3', name: 'Title', role: 'headline', props: { x: 60, y: 800, width: 960, height: 100, text: `Card ${c}: pick what fits`, style: text(72, '#263238FF', 800) } },
      body: { type: 'text', parentId: p, index: 'a4', name: 'Body', role: 'body', props: { x: 60, y: 910, width: 960, height: 80, text: 'Every size, every format, one campaign. Swipe for more.', style: text(32, '#455A64FF') } },
      cta: { type: 'graphic', parentId: p, index: 'a5', name: 'Button', role: 'cta', props: { x: 760, y: 990, width: 260, height: 64, shape: { kind: 'rect', cornerRadius: 32 }, fills: [{ type: 'solid', color: '#FF5A36FF' }] } },
    }
    for (const [id, node] of Object.entries(layers)) nodes[`${p}-${id}`] = node
    for (const [formatId, f] of Object.entries(FORMATS)) {
      if (formatId === 'sq') continue
      const sx = f.width / 1080
      const sy = f.height / 1080
      const scoped = (overrides[`format:${formatId}`] ??= {})
      for (const [id, node] of Object.entries(layers)) {
        const { x, y, width, height } = node.props as { x: number; y: number; width: number; height: number }
        scoped[`${p}-${id}`] = { x: Math.round(x * sx), y: Math.round(y * sy), width: Math.round(width * sx), height: Math.round(height * sy) }
      }
      scoped[`${p}-title`] = { ...scoped[`${p}-title`], style: text(Math.round(72 * Math.min(sx, sy)), '#263238FF', 800) }
      if (formatId === 'mpu') scoped[`${p}-body`] = { ...scoped[`${p}-body`], visible: false }
    }
  }
  return {
    meta: { schemaVersion: 1, designId: 'big-carousel', name: 'Big carousel', kind: 'carousel', primaryFormatId: 'sq' },
    formats, pages, nodes, overrides,
  }
}
