import { expect, test as base, type Page } from '@playwright/test'
import { API_URL } from './seed.ts'

export { expect }
export type { Browser, Locator, Page, Request } from '@playwright/test'

type Guard = {
  /** Lets this test cause the problems these patterns match, such as a 404 it asks for on purpose. */
  allowProblems: (...patterns: RegExp[]) => void
}

/**
 * Playwright's `test`, failing any test whose pages throw, log a console error or get a 4xx or 5xx
 * from the web app or the API. Every spec imports `test` from here (lint enforces it).
 */
export const test = base.extend<Guard>({
  allowProblems: [async ({ context, baseURL }, use) => {
    const origins = new Set([new URL(baseURL ?? 'http://localhost:3100').origin, new URL(API_URL).origin])
    const allowed: RegExp[] = []
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
    await use((...patterns) => allowed.push(...patterns))
    const unexpected = problems.filter((problem) => !allowed.some((pattern) => pattern.test(problem)))
    expect(unexpected, 'the browser reported problems during this test').toEqual([])
  }, { auto: true }],
})
