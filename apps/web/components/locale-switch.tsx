'use client'

import { useRouter } from 'next/navigation'
import { useLocale, useMessages } from '../lib/i18n/client.tsx'
import { LOCALE_NAMES, LOCALES, type Locale } from '../lib/i18n/index.ts'
import { segment, SEGMENTED } from './ui/segmented.tsx'

/** Picks the UI language, each named in itself; Arabic mirrors the whole UI. */
export function LocaleSwitch() {
  const locale = useLocale()
  const t = useMessages().language
  const router = useRouter()
  function choose(next: Locale) {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
  return (
    <div role="radiogroup" aria-label={t.label} className={SEGMENTED}>
      {LOCALES.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={l === locale} lang={l} onClick={() => l !== locale && choose(l)} className={segment(l === locale)}>
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  )
}
