'use client'

// Onboarding's "Paste your website" form (#109, #203): one wide field with its button inside the
// end, as in the final mock. It takes an address or a plain name; the line under it names the brand
// an address gives, with Change to type another.
import { ArrowRightIcon, GlobeIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { BrandNaming, type NamingWords } from './brand-naming.tsx'

export function BrandStartForm({ action, words, error, back }: {
  action: (form: FormData) => Promise<void>
  words: NamingWords & { start: string; placeholder: string; open: string }
  /** Why the last try made no brand, if it didn't. */
  error: string | null
  /** The Back link, under the form. */
  back: ReactNode
}) {
  const [start, setStart] = useState('')
  return (
    // The grid puts the button in the field's row while the naming line stays next in the tab order.
    <form action={action} className="isolate mx-auto mt-8 grid w-full max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
      {/* The field's own ring would cut through the bar; the bar's edge shows focus instead. */}
      <label className="peer col-start-1 row-start-1 flex min-w-0 items-center gap-3 ps-5">
        <GlobeIcon size={20} aria-hidden className="shrink-0 text-muted" />
        <span className="sr-only">{words.start}</span>
        <input
          name="start"
          maxLength={2048}
          autoComplete="url"
          placeholder={words.placeholder}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-16 w-full min-w-0 bg-transparent text-base text-text placeholder:text-subtle md:text-lg"
          style={{ outline: 'none' }}
          autoFocus
        />
      </label>
      <span aria-hidden className="col-span-2 col-start-1 row-start-1 -z-10 h-16 rounded-[18px] border-[1.5px] border-line bg-surface shadow-panel transition-[border-color,box-shadow] duration-[var(--chrome-fast)] peer-hover:border-line-strong peer-focus-within:border-accent peer-focus-within:shadow-[0_0_0_4px_var(--accent-soft)]" />
      <BrandNaming start={start} words={words} size="hero" className="col-span-2 row-start-2 mt-4 min-h-5 md:mx-5" />
      {error && <p role="alert" className="col-span-2 row-start-3 mt-3 text-sm text-danger md:mx-5">{error}</p>}
      <div className="col-span-2 row-start-4 mt-6 flex justify-center">{back}</div>
      <button
        type="submit"
        className="ai-glow relative col-start-2 row-start-1 me-2.5 inline-flex h-11 cursor-pointer items-center gap-2 rounded-[12px] px-5 text-[15px] font-semibold text-white shadow-panel transition-transform duration-[var(--chrome-fast)] active:scale-[0.97]"
      >
        {words.open}
        <ArrowRightIcon size={16} weight="bold" aria-hidden className="rtl:-scale-x-100" />
      </button>
    </form>
  )
}
