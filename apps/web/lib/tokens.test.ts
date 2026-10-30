// Every text token reads at 4.5:1 or more on every surface it sits on, in both themes (#51).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(selector)
  const block = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const TEXT = ['text', 'text-muted', 'text-subtle', 'accent-text', 'danger', 'success', 'warning']
const SURFACES = ['bg', 'surface', 'raised', 'hover']

describe.each([['dark', "[data-theme='dark']"], ['light', "[data-theme='light']"]])('%s theme', (_, selector) => {
  const t = tokens(selector)

  it.each(TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface])))('%s on %s is at least 4.5:1', (text, surface) => {
    const fg = t[text]
    const bg = t[surface]
    if (!fg || !bg) throw new Error(`missing token ${fg ? surface : text}`)
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('text on the pink buttons is at least 4.5:1', () => {
    for (const button of ['accent-solid', 'accent-solid-hover']) {
      expect(contrast(t['on-accent'] ?? '', t[button] ?? '')).toBeGreaterThanOrEqual(4.5)
    }
  })
})
