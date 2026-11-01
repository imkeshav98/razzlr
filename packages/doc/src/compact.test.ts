import { parseDesign } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { compact, loadDesign, openSession, readDesign, type DesignDoc } from './index.ts'
import { testDesign } from './test-design.ts'

const freshDoc = () => {
  const result = parseDesign(testDesign())
  if (!result.success) throw new Error(result.errors.join('\n'))
  return loadDesign(result.design)
}
const sizeOf = (doc: DesignDoc) => Y.encodeStateAsUpdate(doc).byteLength
const badge = (x: number) => ({
  type: 'graphic',
  name: 'Badge',
  props: { x, y: 40, width: 120, height: 120, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#FFC400FF' }] },
} as const)

/** 50 layers that stay, made with commands, and with `deletes` more made, overridden and deleted. */
function edited(deletes: number) {
  const doc = freshDoc()
  const tab = openSession(doc)
  for (let i = 0; i < 50; i++) tab.run('node.create', { parentId: 'p1', layer: badge(i) })
  for (let i = 0; i < deletes; i++) {
    const id = tab.run('node.create', { parentId: 'p1', layer: badge(i) })
    tab.run('node.update', { ids: [id], scope: 'format:banner', patch: { x: 8, width: 40 } })
    tab.run('node.delete', { ids: [id] })
  }
  return { doc, tab }
}

describe('compact', () => {
  // 3,000 commands: under 1 s here, but over vitest's default 5 s on a CI runner busy with other packages' tests.
  it('drops 1,000 deleted layers and their overrides, and the design reads the same', () => {
    const { doc } = edited(1000)
    const design = readDesign(doc)
    const before = sizeOf(doc)

    expect(compact(doc)).toEqual({ layers: 1000, overrides: 2000 })

    expect(readDesign(doc)).toEqual(design)
    // Yjs keeps each dropped key's name, so this is not as small as a design that never had them,
    // but most of it is gone.
    expect(sizeOf(doc)).toBeLessThan(before / 3)
    // And the doc a tab would load has nothing deleted left in it.
    const loaded = new Y.Doc()
    Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc))
    expect(loaded.getMap('nodes').size).toBe(Object.keys(design.nodes).length)
  }, 30_000)

  it('writes nothing when nothing was deleted', () => {
    const { doc } = edited(0)
    const before = Y.encodeStateVector(doc)
    expect(compact(doc)).toEqual({ layers: 0, overrides: 0 })
    expect(Y.encodeStateVector(doc)).toEqual(before)
  })

  it('a tab that kept the old state, and edited offline, comes back to the same design', () => {
    const { doc: server, tab } = edited(20)
    const box = tab.run('node.create', { parentId: 'p1', layer: badge(300) })
    const offline = new Y.Doc()
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(server))
    // It left and edited a layer that is still there; meanwhile the server compacted.
    openSession(offline).run('node.update', { ids: [box], patch: { x: 640 } })
    compact(server)

    Y.applyUpdate(server, Y.encodeStateAsUpdate(offline, Y.encodeStateVector(server)))
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(server, Y.encodeStateVector(offline)))

    expect(readDesign(offline)).toEqual(readDesign(server))
    expect(readDesign(server).nodes[box]?.props).toMatchObject({ x: 640 })
    expect(offline.getMap('nodes').size).toBe(server.getMap('nodes').size)
  })

  it('a tab cut off before compaction can no longer undo its delete, and nothing breaks', () => {
    const { doc: server } = edited(0)
    const cutOff = new Y.Doc()
    Y.applyUpdate(cutOff, Y.encodeStateAsUpdate(server))
    const tab = openSession(cutOff)
    const id = tab.run('node.create', { parentId: 'p1', layer: badge(1) })
    tab.run('node.delete', { ids: [id] })
    Y.applyUpdate(server, Y.encodeStateAsUpdate(cutOff, Y.encodeStateVector(server)))
    // It drops off, the server compacts, and the tab undoes the delete before it reconnects.
    compact(server)
    tab.undo()
    expect(readDesign(cutOff).nodes[id]).toBeDefined()

    Y.applyUpdate(cutOff, Y.encodeStateAsUpdate(server, Y.encodeStateVector(cutOff)))
    Y.applyUpdate(server, Y.encodeStateAsUpdate(cutOff, Y.encodeStateVector(server)))
    expect(readDesign(cutOff).nodes[id]).toBeUndefined()
    expect(readDesign(cutOff)).toEqual(readDesign(server))
  })

  it('a tab that opens after compaction can undo its own edits as usual', () => {
    const { doc } = edited(10)
    compact(doc)
    const tab = openSession(doc)
    const id = tab.run('node.create', { parentId: 'p1', layer: badge(1) })
    tab.run('node.delete', { ids: [id] })
    tab.undo()
    expect(readDesign(doc).nodes[id]).toMatchObject({ name: 'Badge' })
  })
})
