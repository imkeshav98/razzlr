// The brand home's brief (#84): the formats it offers, and the blank design Make drafts opens
// until AI drafts arrive (phase 2).
import { FORMAT_PRESETS, SCHEMA_VERSION, type DesignInput } from '@razzlr/schema'

/** The formats offered on the brief, the everyday ones; the editor adds any other. */
export const BRIEF_FORMATS = ['feed-square', 'feed-portrait', 'story', 'link-image'] as const

export type BriefFormat = (typeof BRIEF_FORMATS)[number]

/** A blank design in the formats a brief picked, the first one primary. */
export function briefDesign(name: string, formatIds: string[], formatName: (id: string) => string): DesignInput {
  const picked = FORMAT_PRESETS.filter((p) => formatIds.includes(p.id))
  const presets = picked.length > 0 ? picked : FORMAT_PRESETS.filter((p) => p.id === BRIEF_FORMATS[0])
  return {
    meta: { schemaVersion: SCHEMA_VERSION, designId: 'replaced-by-the-api', name, kind: 'single', primaryFormatId: 'f1' },
    formats: Object.fromEntries(presets.map((p, i) => [`f${i + 1}`, { name: formatName(p.id), width: p.width, height: p.height, order: `a${i}` }])),
    pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
    nodes: {},
    overrides: {},
  }
}
