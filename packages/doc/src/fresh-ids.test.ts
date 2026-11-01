import { parseDesign } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import { withFreshIds } from './fresh-ids.ts'
import { testDesign } from './test-design.ts'

describe('withFreshIds (#54)', () => {
  it('gives every format, page and layer a new id and keeps everything that names them', () => {
    const parsed = parseDesign(testDesign())
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const before = parsed.design
    const after = withFreshIds(before)
    const ids = (d: typeof before) => [...Object.keys(d.formats), ...Object.keys(d.pages), ...Object.keys(d.nodes)]
    expect(ids(after).filter((id) => ids(before).includes(id))).toEqual([])
    expect(ids(after)).toHaveLength(ids(before).length)
    // Still a valid design, the same in every way but its ids.
    const again = parseDesign(after)
    if (!again.success) throw new Error(again.errors.join('\n'))
    expect(after.formats[after.meta.primaryFormatId]).toEqual(before.formats[before.meta.primaryFormatId])
    const headline = Object.entries(after.nodes).find(([, n]) => n.name === 'Headline')
    expect(headline?.[1].parentId).toBe(Object.keys(after.pages)[0])
    const banner = Object.keys(after.formats).find((id) => after.formats[id]?.name === before.formats.banner?.name)
    expect(after.overrides[`format:${banner}`]?.[headline?.[0] ?? '']).toEqual(before.overrides['format:banner']?.headline)
  })
})
