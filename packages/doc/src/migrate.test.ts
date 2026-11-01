// Schema version 2 at the commands seam (#43): node.update sets every new property, and a
// document saved at version 1 is migrated when a tab opens it, outside its undo history.
import { parseDesign, SCHEMA_VERSION, type DesignInput } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadDesign, migrateDoc, openSession, readDesign } from './index.ts'
import { root } from './design-doc.ts'
import { testDesign } from './test-design.ts'

const freshDoc = (design: DesignInput = testDesign()) => {
  const result = parseDesign(design)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return loadDesign(result.design)
}

const stops = [{ offset: 0, color: '#FF0000FF' }, { offset: 1, color: '#0000FFFF' }]

describe('node.update sets each new property', () => {
  it('angular gradients, and strokes with dashes, caps, joins and a miter limit', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    tab.run('node.update', { ids: ['box'], patch: { fills: [{ type: 'angular', center: { x: 0.5, y: 0.5 }, angle: 30, stops }] } })
    tab.run('node.update', { ids: ['box'], patch: { strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4, dashes: [8, 4], dashOffset: 2, cap: 'round', join: 'bevel', miterLimit: 2 }] } })
    // In one format only.
    tab.run('node.update', { ids: ['box'], scope: 'format:banner', patch: { strokes: [{ paint: { type: 'angular', center: { x: 0, y: 0 }, stops }, width: 1, cap: 'square' }] } })

    const design = readDesign(doc)
    expect(design.nodes.box?.props).toMatchObject({
      fills: [{ type: 'angular', center: { x: 0.5, y: 0.5 }, angle: 30, stops }],
      strokes: [{ width: 4, align: 'center', dashes: [8, 4], dashOffset: 2, cap: 'round', join: 'bevel', miterLimit: 2 }],
    })
    expect(design.overrides['format:banner']?.box?.strokes).toEqual([
      { paint: { type: 'angular', center: { x: 0, y: 0 }, angle: 0, stops }, width: 1, align: 'center', dashes: [], dashOffset: 0, cap: 'square', join: 'miter', miterLimit: 4 },
    ])
    tab.undo()
    tab.undo()
    expect(readDesign(doc).nodes.box?.props).toMatchObject({ strokes: [] })
  })

  it('inner shadow, glow and background blur', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    const effects = [
      { type: 'innerShadow', x: 1, y: 2, blur: 3, spread: 1, color: '#00000080' },
      { type: 'glow', blur: 12, color: '#FF2E7EFF' },
      { type: 'backgroundBlur', radius: 20 },
    ] as const
    tab.run('node.update', { ids: ['box', 'headline'], patch: { effects: [...effects] } })
    const design = readDesign(doc)
    for (const id of ['box', 'headline']) {
      expect(design.nodes[id]?.props.effects).toEqual([effects[0], { ...effects[1], spread: 0 }, effects[2]])
    }
    expect(() => tab.run('node.update', { ids: ['box'], patch: { effects: [{ type: 'glow', blur: -1, color: '#000000FF' }] } })).toThrow(/box.effects.0.blur/)
  })

  it('pass-through and normal on groups and frames, never on other layers', () => {
    const doc = freshDoc()
    const tab = openSession(doc)
    const group = tab.run('node.group', { ids: ['box', 'headline'] })
    expect(readDesign(doc).nodes[group]?.props.blendMode).toBe('pass-through')
    tab.run('node.update', { ids: [group], patch: { blendMode: 'normal' } })
    expect(readDesign(doc).nodes[group]?.props.blendMode).toBe('normal')
    tab.run('node.update', { ids: [group], scope: 'format:banner', patch: { blendMode: 'pass-through' } })
    expect(readDesign(doc).overrides['format:banner']?.[group]).toMatchObject({ blendMode: 'pass-through' })
    expect(() => tab.run('node.update', { ids: ['box'], patch: { blendMode: 'pass-through' } })).toThrow(/box.blendMode/)
  })
})

/** The test design at version 1: a group of the box, saved with `normal` as version 1 wrote it, and overridden in the banner. */
const version1Doc = () => {
  const design = testDesign()
  const box = design.nodes.box
  if (!box) throw new Error('no box')
  const doc = freshDoc({
    ...design,
    nodes: {
      ...design.nodes,
      box: { ...box, parentId: 'g' },
      g: { type: 'group', parentId: 'p1', index: 'a2', name: 'Group', props: { x: 100, y: 100, width: 200, height: 100, blendMode: 'normal' } },
    },
    overrides: { ...design.overrides, 'format:banner': { ...design.overrides?.['format:banner'], g: { blendMode: 'normal', opacity: 0.5 } } },
  })
  // What a version 1 document holds: loadDesign writes version 2's values, so put version 1's back.
  const r = root(doc)
  doc.transact(() => {
    r.meta.set('schemaVersion', 1)
    ;(r.nodes.get('g')?.get('props') as Y.Map<unknown>).set('blendMode', 'normal')
    r.overrides.set('format:banner|g|blendMode', 'normal')
  })
  return doc
}

describe('a version 1 document', () => {
  it('reads as the current version before anything writes to it', () => {
    const doc = version1Doc()
    const design = readDesign(doc)
    expect(design.meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(design.nodes.g?.props.blendMode).toBe('pass-through')
    expect(design.overrides['format:banner']?.g).toEqual({ blendMode: 'pass-through', opacity: 0.5 })
    expect(root(doc).meta.get('schemaVersion')).toBe(1)
  })

  it('is migrated when a tab opens it, and undo never takes the migration back', () => {
    const doc = version1Doc()
    const tab = openSession(doc)
    const r = root(doc)
    expect(r.meta.get('schemaVersion')).toBe(SCHEMA_VERSION)
    expect((r.nodes.get('g')?.get('props') as Y.Map<unknown>).get('blendMode')).toBe('pass-through')
    expect(r.overrides.get('format:banner|g|blendMode')).toBe('pass-through')
    // Only what changed was written: the box's blend mode was already right.
    expect(tab.canUndo()).toBe(false)
    tab.run('node.update', { ids: ['g'], patch: { opacity: 0.8 } })
    tab.undo()
    expect(readDesign(doc).nodes.g?.props).toMatchObject({ blendMode: 'pass-through', opacity: 1 })
    expect(tab.canUndo()).toBe(false)
    expect(migrateDoc(doc)).toBe(false)
  })

  it('migrates on the first command when it arrives after the tab opened', () => {
    const doc = new Y.Doc()
    const tab = openSession(doc)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(version1Doc()))
    expect(root(doc).meta.get('schemaVersion')).toBe(1)
    tab.run('node.update', { ids: ['box'], patch: { x: 10 } })
    expect(root(doc).meta.get('schemaVersion')).toBe(SCHEMA_VERSION)
    tab.undo()
    expect(readDesign(doc).nodes.box?.props.x).toBe(100)
    expect(root(doc).meta.get('schemaVersion')).toBe(SCHEMA_VERSION)
  })

  it('migrated by two tabs at once merges to one result', () => {
    const a = version1Doc()
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    openSession(a)
    openSession(b)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(readDesign(a)).toEqual(readDesign(b))
    expect(readDesign(a).nodes.g?.props.blendMode).toBe('pass-through')
  })
})
