// Compaction (#57): while a tab is connected, a deleted layer stays so undo can bring it back; once
// everyone has left, the sync server drops deleted layers and stores a smaller design, and whoever
// opens it next sees the same design and the same export.
import { expect, test, type Page } from '../support/test.ts'
import { designOf, exportHashOf, openTabs, settle, storedSize, writeOutput } from '../support/editor.ts'
import { liveDesign, seed } from '../support/seed.ts'

test.describe.configure({ timeout: 120_000 })

/**
 * The design as JSON, without override scopes left empty: a scope whose layers were all deleted
 * reads as `{}` until compaction removes its keys, and then not at all. Both mean the same.
 */
const designWithoutEmptyScopes = async (page: Page) => {
  const design = JSON.parse(await designOf(page)) as { overrides: Record<string, object> }
  design.overrides = Object.fromEntries(Object.entries(design.overrides).filter(([, byNode]) => Object.keys(byNode).length > 0))
  return design
}

/** Makes `count` layers, overrides each in the banner format and deletes it, as commands in the tab. */
const makeAndDelete = (page: Page, count: number) => page.evaluate((count) => {
  const editor = window.dazbee
  if (!editor) throw new Error('no editor')
  for (let i = 0; i < count; i++) {
    const id = editor.session.run('node.create', { parentId: 'p1', layer: { type: 'graphic', name: `Try ${i}`, props: { x: 10 * i, y: 40, width: 200, height: 200, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#FFC400FF' }] } } })
    editor.session.run('node.update', { ids: [id], scope: 'format:banner', patch: { x: 8, y: 4, width: 40, height: 40 } })
    editor.session.run('node.delete', { ids: [id] })
  }
}, count)

test('undo of a delete still works with another tab connected; once both leave the design is compacted and reopens the same', async ({ browser }) => {
  const live = liveDesign()
  const designId = await seed({ ...live, formats: { ...live.formats, banner: { name: 'Banner', width: 1200, height: 628, order: 'a1' } } })
  const { tabs, errors } = await openTabs(browser, 2, designId)
  const [a, b] = tabs as [Page, Page]

  await makeAndDelete(a, 300)
  // The two-tab check: B deletes a layer and undoes it while A is connected, and both see it back.
  const kept = await b.evaluate(() => {
    const editor = window.dazbee
    if (!editor) throw new Error('no editor')
    const id = editor.session.run('node.create', { parentId: 'p1', layer: { type: 'graphic', name: 'Kept', props: { x: 600, y: 600, width: 120, height: 120, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#1E88E5FF' }] } } })
    editor.session.run('node.delete', { ids: [id] })
    editor.session.undo()
    return id
  })
  await settle([a, b])
  expect(JSON.parse(await designOf(a)).nodes[kept]).toMatchObject({ name: 'Kept' })
  const design = await designWithoutEmptyScopes(a)
  const hash = await exportHashOf(a)
  await expect.poll(() => storedSize(designId), { timeout: 30_000 }).toBeGreaterThan(0)
  // Stored with the deleted layers still in it, while anyone is connected.
  await expect.poll(async () => { const s = storedSize(designId); await new Promise((r) => setTimeout(r, 1500)); return s === storedSize(designId) }, { timeout: 30_000 }).toBe(true)
  const before = storedSize(designId)

  await a.context().close()
  await new Promise((r) => setTimeout(r, 1500))
  expect(storedSize(designId)).toBe(before)
  await b.context().close()
  await expect.poll(() => storedSize(designId), { timeout: 30_000 }).toBeLessThan(before * 0.7)
  const after = storedSize(designId)

  const { tabs: [again], errors: againErrors } = await openTabs(browser, 1, designId)
  if (!again) throw new Error('no tab')
  expect(await designWithoutEmptyScopes(again)).toEqual(design)
  expect(await exportHashOf(again)).toBe(hash)
  writeOutput('compaction-sizes.json', JSON.stringify({ deletes: 300, before, after }, null, 2))
  writeOutput('compaction-0-reopened.png', await again.screenshot())
  expect([...errors, ...againErrors]).toEqual([])
})
