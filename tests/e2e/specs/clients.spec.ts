// The Clients page (ADR-0011) as in the final mock: a card per client in its kit's colours, with
// how many designs it has, and a last card that adds a client and opens its home. The words are a
// brand's if a test in smoke.spec has the workspace on another kind just then.
import { expect, test } from '../support/test.ts'
import { writeOutput } from '../support/editor.ts'

test('each client has a card with its design count, and New client adds one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const clients = page.getByRole('list', { name: /^(Clients|Brands)$/ })
  const coffee = clients.getByRole('link', { name: /^Harbour Coffee/ })
  await expect(coffee).toHaveAttribute('href', '/brands/dev-brand-coffee')
  await expect(coffee).toContainText(/No designs yet|1 design|\d+ designs/)
  writeOutput('clients-1-cards.png', await page.screenshot())

  const name = `Juniper Bakery ${crypto.randomUUID().slice(0, 4)}`
  await clients.getByRole('button', { name: /^New (client|brand)$/ }).click()
  const field = clients.getByRole('textbox', { name: /^(Client|Brand) name$/ })
  await expect(field).toBeFocused()
  // Esc puts the card back; opening it again keeps going.
  await field.press('Escape')
  await clients.getByRole('button', { name: /^New (client|brand)$/ }).click()
  await clients.getByRole('textbox', { name: /^(Client|Brand) name$/ }).fill(name)
  writeOutput('clients-2-new.png', await page.screenshot())
  await clients.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`What are we making for ${name}?`)
  await expect(page).toHaveURL(/\/brands\/[\w-]+$/)

  await page.goto('/')
  await expect(clients.getByRole('link', { name: new RegExp(`^${name}`) })).toContainText('No designs yet')
})
