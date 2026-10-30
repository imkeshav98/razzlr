import type { Rendered } from '@razzlr/renderer'
import type { DesignInput } from '@razzlr/schema'
import { draw, type Kit } from './draw.ts'
import type { BrandFamily, Script } from './fonts.ts'
import { indexAt } from './layout.ts'

const SAMPLE: Record<Script, string> = {
  latin: 'Big Sale 50% OFF $1,299',
  devanagari: 'दिवाली सेल ₹1,299 Big Sale',
  arabic: 'خصم كبير ٥٠٪ Big Sale 50%',
}

/**
 * A sheet showing every family and weight in our renderer, labelled, for the read step to match
 * a flat draft's lettering against: the fonts it may pick are exactly the ones drawn here.
 */
export function specimen(kit: Kit, families: BrandFamily[], script: Script): Rendered {
  const rows = families.filter((f) => f.scripts.includes(script)).flatMap((f) => f.weights.map((w) => ({ family: f.family, weight: w })))
  const rowHeight = 84
  const width = 1400
  const nodes: DesignInput['nodes'] = {}
  for (const [i, row] of rows.entries()) {
    const y = 20 + i * rowHeight
    nodes[`label${i}`] = {
      type: 'text', parentId: 'p1', index: indexAt(i * 2), name: 'label',
      props: { x: 20, y: y + 20, width: 420, height: 40, text: `${row.family} ${row.weight}`, boxMode: 'fixed', style: { fontFamily: 'Noto Sans', fontWeight: 400, fontSize: 26, color: '#555555FF' } },
    }
    const text = SAMPLE[script]
    nodes[`sample${i}`] = {
      type: 'text', parentId: 'p1', index: indexAt(i * 2 + 1), name: 'sample',
      props: { x: 450, y, width: 940, height: rowHeight, text, boxMode: 'fixed', verticalAlign: 'middle', style: { fontFamily: row.family, fontWeight: row.weight, fontSize: 44, color: '#111111FF' } },
    }
  }
  const design: DesignInput = {
    meta: { schemaVersion: 1, designId: 'specimen', name: 'specimen', kind: 'single', primaryFormatId: 'f' },
    formats: { f: { name: 'sheet', width, height: 40 + rows.length * rowHeight, order: 'a0' } },
    pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
    nodes,
    overrides: {},
  }
  return draw(kit, design, {})
}
