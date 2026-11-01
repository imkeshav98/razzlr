'use client'

// Under a brand's start field (#203): when an address was typed, the name it gives the brand, with
// Change to type another; a plain name needs no line. Change opens the form's `name` field, filled
// with that name.
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { readBrandStart } from '../lib/home.ts'

export type NamingWords = { callIt: string; change: string; name: string }

export function BrandNaming({ start, words, size = 'compact', className }: {
  /** What the start field holds now. */
  start: string
  words: NamingWords
  size?: 'hero' | 'compact'
  className?: string
}) {
  const read = readBrandStart(start)
  const [naming, setNaming] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (naming) field.current?.focus()
  }, [naming])
  const hero = size === 'hero'
  const [before, after = ''] = words.callIt.split('{name}')
  return (
    <div aria-live="polite" className={cn(hero ? 'text-sm' : 'text-[12px]', 'text-muted', className)}>
      {naming
        ? (
          <label className={cn('flex flex-col gap-1.5 font-medium', hero ? 'text-[13px]' : 'text-[12px]')}>
            {words.name}
            <input
              ref={field}
              name="name"
              required
              maxLength={120}
              defaultValue={read?.name ?? ''}
              autoComplete="organization"
              className={cn(
                'w-full min-w-0 rounded-row border border-line text-text outline-none transition-colors duration-[var(--chrome-fast)] hover:border-line-strong focus:border-accent',
                hero ? 'h-11 rounded-[12px] bg-surface px-4 text-[15px]' : 'h-9 bg-bg px-3 text-[14px]',
              )}
            />
          </label>
        )
        : read?.website && (
          <p className="[overflow-wrap:anywhere]">
            {before}
            <b className="font-semibold text-text">{read.name}</b>
            {after}
            <span aria-hidden> · </span>
            <button type="button" onClick={() => setNaming(true)} className="cursor-pointer font-semibold text-accent-text hover:underline">
              {words.change}
            </button>
          </p>
        )}
    </div>
  )
}
