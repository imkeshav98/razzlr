// Autosave and offline edits (#37): the design is kept in the browser, an edit made offline
// survives a reload without a connection, and it reaches the other tab once the connection is back.
import { expect, test, type Page } from '../support/test.ts'
import { designOf, openTabs, settle, writeOutput } from '../support/editor.ts'

const headline = async (page: Page) => (JSON.parse(await designOf(page)) as { nodes: { headline: { props: { text: string } } } }).nodes.headline.props.text

/** Records every status the badge reports, so a Saving that lasts a few milliseconds is still seen. */
const recordStatuses = (page: Page) => page.evaluate(() => {
  const badge = document.querySelector('[data-testid=status]')
  if (!badge) throw new Error('no status')
  const seen = [badge.getAttribute('data-status')]
  new MutationObserver(() => seen.push(badge.getAttribute('data-status'))).observe(badge, { attributeFilter: ['data-status'] })
  ;(window as unknown as { statuses: unknown[] }).statuses = seen
})
const statuses = (page: Page) => page.evaluate(() => (window as unknown as { statuses: string[] }).statuses)

const typeAtEnd = (page: Page, text: string) => page.evaluate(async (text) => {
  const editor = window.razzlr
  if (!editor) throw new Error('no editor')
  for (const ch of text) {
    const node = editor.design().nodes.headline
    if (node?.type !== 'text') throw new Error('no headline')
    editor.session.run('text.edit', { id: 'headline', op: { kind: 'insert', at: node.props.text.length, text: ch } })
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}, text)

test('an edit made offline survives a reload offline and reaches the other tab when back online', async ({ browser }) => {
  test.setTimeout(120_000)
  const { tabs, errors } = await openTabs(browser, 2)
  const [a, b] = tabs as [Page, Page]
  const status = a.getByTestId('status')

  // The worker keeps the page and what it loaded, so it opens again without a connection.
  await expect.poll(() => a.evaluate(async () => Boolean(await caches.match(location.href)) && Boolean(await caches.match('/vendor/canvaskit.wasm'))), { timeout: 30_000 }).toBe(true)
  await expect(status).toHaveAttribute('data-status', 'Saved')
  await expect(status).toHaveText('Saved')
  writeOutput('offline-0-saved.png', await a.screenshot())

  // Saving while the sync server has not confirmed the edits, Saved once it has.
  await recordStatuses(a)
  await typeAtEnd(a, ' now')
  await expect(status).toHaveAttribute('data-status', 'Saved')
  expect(await statuses(a)).toEqual(expect.arrayContaining(['Saving', 'Saved']))
  await settle([a, b])
  expect(await headline(b)).toBe('Summer sale now')

  // The badge holds Saving a moment after the last edit, long enough to see.
  await typeAtEnd(a, '!')
  await expect(status).toHaveText('Saving')
  writeOutput('offline-1-saving.png', await a.screenshot())
  await expect(status).toHaveText('Saved')

  // Without a connection: Offline, and edits are kept on this device.
  await a.context().setOffline(true)
  await expect(status).toHaveAttribute('data-status', 'Offline', { timeout: 30_000 })
  await expect(status).toContainText('Offline')
  await typeAtEnd(a, ' 2')
  writeOutput('offline-2-offline.png', await a.screenshot())

  // A reload with no network at all: the page comes from the worker and the design from IndexedDB.
  await a.reload()
  await expect(status).toHaveAttribute('data-ready', '', { timeout: 30_000 })
  await expect(status).toHaveAttribute('data-status', 'Offline', { timeout: 30_000 })
  expect(await headline(a)).toBe('Summer sale now! 2')
  expect(await headline(b)).toBe('Summer sale now!')
  writeOutput('offline-3-reloaded-offline.png', await a.screenshot())

  // Back online, the offline edit reaches the other tab.
  await a.context().setOffline(false)
  await expect(status).toHaveAttribute('data-status', 'Saved', { timeout: 30_000 })
  await settle([a, b])
  expect(await headline(b)).toBe('Summer sale now! 2')
  writeOutput('offline-4-back-online.png', await b.screenshot())
  expect(errors).toEqual([])
})
