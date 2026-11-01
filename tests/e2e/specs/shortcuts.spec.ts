// The keyboard shortcuts list (#158) in Chromium: it opens with ? and from the View card's keyboard
// button, lists every shortcut of the editor's table in its groups, never opens while typing, and
// closes with Esc.
import { expect, test } from '../support/test.ts'
import { SHORTCUTS } from '@dazbee/editor'
import type { DesignInput } from '@dazbee/schema'
import { writeOutput } from '../support/editor.ts'
import { openStage } from '../support/stage.ts'

test.describe.configure({ timeout: 120_000 })

const design = (): DesignInput => ({
  meta: { schemaVersion: 3, designId: 'replaced-by-the-api', name: 'Shortcuts', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {},
  overrides: {},
})

test('? and the keyboard button list every shortcut', async ({ browser }) => {
  const { page, errors } = await openStage(browser, design())
  const list = page.getByTestId('shortcuts')
  await expect(list).toBeHidden()

  await page.keyboard.press('Shift+Slash')
  await expect(list).toBeVisible()
  await expect(list.getByRole('heading', { level: 2 })).toHaveText('Keyboard shortcuts')
  await expect(list.locator('[data-shortcut]')).toHaveCount(SHORTCUTS.length)
  await expect(list.locator('[data-shortcut="bringForward"] kbd')).toHaveText(['Ctrl', ']'])
  writeOutput('shortcuts.png', await page.screenshot())
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()

  // Typing ? into a field types it.
  const card = page.getByTestId('page-card')
  await card.getByRole('button', { name: 'Fine-tune' }).click()
  const hex = card.getByRole('textbox', { name: 'Hex', exact: true })
  await hex.fill('')
  await hex.press('Shift+Slash')
  await expect(hex).toHaveValue('?')
  await expect(list).toBeHidden()
  await hex.press('Escape')

  await page.getByTestId('view-card').getByRole('button', { name: 'Keyboard shortcuts' }).click()
  await expect(list).toBeVisible()
  await list.getByRole('button', { name: 'Close' }).click()
  await expect(list).toBeHidden()
  expect(errors).toEqual([])
})
