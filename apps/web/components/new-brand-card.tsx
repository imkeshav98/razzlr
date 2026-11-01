'use client'

// The last card on the Brands or Clients page: a dashed card that opens into a name field. Creating
// the brand opens its home.
import { PlusIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '../lib/cn.ts'
import { buttonStyles } from './ui/button.tsx'

function Create({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} className={cn(buttonStyles({ variant: 'primary' }), 'h-9 px-4 font-semibold')}>{label}</button>
}

export function NewBrandCard({ action, words }: {
  action: (form: FormData) => Promise<void>
  words: { add: string; name: string; create: string; cancel: string }
}) {
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  const card = 'flex h-52 rounded-[20px] border border-dashed border-line-strong'
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
      <label htmlFor="new-brand-name" className="text-sm font-semibold">{words.name}</label>
      <input
        ref={field}
        id="new-brand-name"
        name="name"
        required
        maxLength={120}
        autoComplete="organization"
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="h-10 min-w-0 rounded-row border border-line bg-bg px-3 text-[15px] outline-none hover:border-line-strong focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <Create label={words.create} />
        <button type="button" onClick={() => setOpen(false)} className={cn(buttonStyles({ variant: 'ghost' }), 'h-9 px-3')}>{words.cancel}</button>
      </div>
    </form>
  )
}
