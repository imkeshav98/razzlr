'use client'

import { DesktopIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { useMessages } from '../lib/i18n/client.tsx'
import { THEMES, themeOf, type ThemePick } from '../lib/theme.ts'
import { Tooltip } from './ui/tooltip.tsx'

declare global {
  interface Window { __applyTheme?: () => void }
}

const ICONS = { system: DesktopIcon, light: SunIcon, dark: MoonIcon } as const

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
    <div role="radiogroup" aria-label={t.label} className="flex items-center gap-0.5 rounded-row border border-line bg-surface p-0.5">
      {THEMES.map((theme) => {
        const Icon = ICONS[theme]
        const on = pick === theme
        return (
          <Tooltip key={theme} label={t[theme]} side="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t[theme]}
              onClick={() => choose(theme)}
              className={cn(
                'grid size-7 cursor-pointer place-items-center rounded-[6px] text-subtle transition-colors duration-[var(--chrome-fast)]',
                on ? 'bg-hover text-text' : 'hover:text-text',
              )}
            >
              <Icon size={15} weight={on ? 'bold' : 'regular'} aria-hidden />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
