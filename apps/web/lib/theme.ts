// The person's theme pick: system (the default), light or dark, kept in the `theme` cookie.
export const THEMES = ['system', 'light', 'dark'] as const
export type ThemePick = (typeof THEMES)[number]
export const themeOf = (value: string | undefined): ThemePick => (THEMES as readonly string[]).includes(value ?? '') ? value as ThemePick : 'system'

/**
 * Runs before first paint: resolves "system" to light or dark and keeps following the system
 * while the pick is "system". Without script, :root's dark tokens apply.
 */
export const themeScript = `(() => {
  const root = document.documentElement
  const query = matchMedia('(prefers-color-scheme: light)')
  const apply = () => {
    const pick = (document.cookie.match(/(?:^|; )theme=(\\w+)/) || [])[1] || 'system'
    root.dataset.theme = pick === 'system' ? (query.matches ? 'light' : 'dark') : pick
  }
  apply()
  query.addEventListener('change', apply)
  window.__applyTheme = apply
})()`
