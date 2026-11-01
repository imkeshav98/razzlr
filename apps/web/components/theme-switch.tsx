'use client'

import { useEffect, useState } from 'react'
import { useMessages } from '../lib/i18n/client.tsx'
import { THEMES, themeOf, type ThemePick } from '../lib/theme.ts'
import { segment, SEGMENTED } from './ui/segmented.tsx'

declare global {
  interface Window { __applyTheme?: () => void }
}

/** System, light or dark; only the tokens change. */
export function ThemeSwitch() {
  const t = useMessages().theme
  const [pick, setPick] = useState<ThemePick>('system')
  useEffect(() => setPick(themeOf(document.cookie.match(/(?:^|; )theme=(\w+)/)?.[1])), [])

  function choose(next: ThemePick) {
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`
    setPick(next)
    if (next === 'system') delete document.documentElement.dataset.theme
    window.__applyTheme?.()
  }

  return (
    <div role="radiogroup" aria-label={t.label} className={SEGMENTED}>
      {THEMES.map((theme) => (
        <button key={theme} type="button" role="radio" aria-checked={pick === theme} onClick={() => choose(theme)} className={segment(pick === theme)}>
          {t[theme]}
        </button>
      ))}
    </div>
  )
}
