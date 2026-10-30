'use client'

import { TranslateIcon } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { useLocale, useMessages } from '../lib/i18n/client.tsx'
import { LOCALE_NAMES, LOCALES, type Locale } from '../lib/i18n/index.ts'

/** Picks the UI language; Arabic mirrors the whole UI. */
export function LocaleSwitch() {
  const locale = useLocale()
  const t = useMessages().language
  const router = useRouter()
  function choose(next: Locale) {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
  return (
    <label className="relative flex h-[var(--row)] items-center gap-1.5 rounded-row border border-line bg-surface ps-2 pe-1 text-muted transition-colors duration-[var(--chrome-fast)] focus-within:border-line-strong hover:text-text">
      <TranslateIcon size={15} aria-hidden />
      <span className="sr-only">{t.label}</span>
      <select
        value={locale}
        onChange={(e) => choose(e.target.value as Locale)}
        className="cursor-pointer appearance-none bg-transparent pe-1 text-[13px] text-inherit outline-none"
      >
        {LOCALES.map((l) => <option key={l} value={l} className="bg-raised text-text">{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  )
}
