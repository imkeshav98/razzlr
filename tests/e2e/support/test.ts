import { expect, test as base, type Page } from '@playwright/test'
import { API_URL } from './seed.ts'

export { expect }
export type { Browser, Locator, Page, Request } from '@playwright/test'

type Guard = {
  /** Problems this test causes on purpose, matched against each problem's text. */
  allowedProblems: RegExp[]
  /** Fails the test after it ends when the browser saw a page error, a console error or a failed request. */
  problemGuard: undefined
}

/**
 * Playwright's `test`, failing any test whose pages throw, log a console error or get a 4xx or 5xx
 * from the web app or the API. Every spec imports `test` from here (lint enforces it).
 */
export const test = base.extend<Guard>({
  allowedProblems: [[], { option: true }],
  problemGuard: [async ({ context, allowedProblems, baseURL }, use) => {
    const origins = new Set([new URL(baseURL ?? 'http://localhost:3100').origin, new URL(API_URL).origin])
    const problems: string[] = []
    const watch = (page: Page) => {
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console error: ${message.text()} (${message.location().url})`)
      })
      page.on('response', (response) => {
        const { origin } = new URL(response.url())
        if (response.status() >= 400 && origins.has(origin)) problems.push(`${response.status()} ${response.request().method()} ${response.url()}`)
      })
    }
    context.pages().forEach(watch)
    context.on('page', watch)
    await use(undefined)
    const unexpected = problems.filter((problem) => !allowedProblems.some((allowed) => allowed.test(problem)))
    expect(unexpected, 'the browser reported problems during this test').toEqual([])
  }, { auto: true }],
})
