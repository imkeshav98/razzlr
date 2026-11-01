'use client'

// The last row of the crumb's brand menu: New brand. It opens into a
// website-or-name field in place (#203); creating the brand opens its home. It is there on every page with the crumb, so
// a workspace that opens straight on its one brand can still add another.
import { PlusIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '../lib/cn.ts'
import { BrandNaming, type NamingWords } from './brand-naming.tsx'
import { buttonStyles } from './ui/button.tsx'

function Create({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} className={cn(buttonStyles({ variant: 'primary' }), 'h-9 px-4 font-semibold')}>{label}</button>
}

export function NewBrandRow({ action, words }: {
  action: (form: FormData) => Promise<void>
  words: NamingWords & { add: string; start: string; placeholder: string; create: string }
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="new-brand-row"
        className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-row px-2 text-start text-[13px] font-semibold text-accent-text transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-accent-soft"><PlusIcon size={14} weight="bold" /></span>
        {words.add}
      </button>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-2 p-2">
      <label htmlFor="menu-new-brand" className="text-[12px] font-semibold text-muted">{words.start}</label>
      <div className="flex items-center gap-2">
        <input
          ref={field}
          id="menu-new-brand"
          name="start"
          required
          maxLength={2048}
          autoComplete="url"
          placeholder={words.placeholder}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="h-9 min-w-0 flex-1 rounded-row border border-line bg-bg px-3 text-[14px] outline-none hover:border-line-strong focus:border-accent"
        />
        <Create label={words.create} />
      </div>
      <BrandNaming start={start} words={words} />
    </form>
  )
}
