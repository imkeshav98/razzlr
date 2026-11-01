// Picking from the app's own dropdowns (components/ui/select.tsx), as a person does: open the field,
// then press the option. The list is drawn over the page, outside the field.
import type { Locator } from '@playwright/test'

export async function choose(field: Locator, value: string) {
  await field.click()
  await field.page().locator(`[role="listbox"] [role="option"][data-value="${value}"]`).click()
}
