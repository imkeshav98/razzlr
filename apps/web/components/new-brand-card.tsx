'use client'

// The last card on the Brands page: a dashed card that opens into a website-or-name field
// (#203). Creating the brand opens its home.
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

export function NewBrandCard({ action, words }: {
  action: (form: FormData) => Promise<void>
  words: NamingWords & { add: string; start: string; placeholder: string; create: string; cancel: string }
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  const card = 'flex min-h-52 rounded-[20px] border border-dashed border-line-strong'
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(card, 'w-full cursor-pointer flex-col items-center justify-center gap-2 text-sm font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-accent hover:text-text')}
      >
        <span className="grid size-10 place-items-center rounded-full border border-line-strong"><PlusIcon size={18} aria-hidden /></span>
        {words.add}
      </button>
    )
  }
  return (
    <form action={action} className={cn(card, 'flex-col justify-end gap-3 bg-surface p-5')}>
      <label htmlFor="new-brand-name" className="text-sm font-semibold">{words.start}</label>
      <input
        ref={field}
        id="new-brand-name"
        name="start"
        required
        maxLength={2048}
        autoComplete="url"
        placeholder={words.placeholder}
        value={start}
        onChange={(e) => setStart(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="h-10 min-w-0 rounded-row border border-line bg-bg px-3 text-[15px] outline-none hover:border-line-strong focus:border-accent"
      />
      <BrandNaming start={start} words={words} />
      <div className="flex items-center gap-2">
        <Create label={words.create} />
        <button type="button" onClick={() => setOpen(false)} className={cn(buttonStyles({ variant: 'ghost' }), 'h-9 px-3')}>{words.cancel}</button>
      </div>
    </form>
  )
}
