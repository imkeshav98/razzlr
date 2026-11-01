'use client'

// A bento tile's menu (#159): a round button at the tile's top end that opens Rename, Duplicate and
// Delete. Rename turns the menu into a name field; Delete asks once more before it deletes.
import { DotsThreeIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { cn } from '../lib/cn.ts'
import { useMessages } from '../lib/i18n/client.tsx'
import { format } from '../lib/i18n/index.ts'
import { buttonStyles } from './ui/button.tsx'

type Step = 'menu' | 'rename' | 'delete'

function Submit({ label, danger = false }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonStyles({ variant: danger ? 'secondary' : 'primary' }), 'h-8 px-3 font-semibold', danger && 'border-danger/60 text-danger hover:border-danger hover:bg-danger/10')}
    >
      {label}
    </button>
  )
}

export function TileMenu({ name, rename, duplicate, remove }: {
  /** What the tile is called, for the button's label and the fields. */
  name: string
  rename: (form: FormData) => Promise<void>
  /** Left out where a copy makes no sense, as for a template. */
  duplicate?: () => Promise<void>
  remove: () => Promise<void>
}) {
  const t = useMessages().library
  const [step, setStep] = useState<Step | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!step) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setStep(null)
    const onPress = (event: PointerEvent) => !box.current?.contains(event.target as Node) && setStep(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPress)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPress)
    }
  }, [step])
  const row = 'flex h-9 w-full cursor-pointer items-center rounded-row px-3 text-start text-[13px] font-medium hover:bg-hover'
  return (
    <div ref={box} className="absolute end-2 top-2 z-10" data-testid="tile-menu">
      <button
        type="button"
        aria-label={format(t.moreFor, { name })}
        aria-expanded={step !== null}
        onClick={() => setStep(step ? null : 'menu')}
        className={cn(
          'grid size-8 cursor-pointer place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-opacity duration-[var(--chrome-fast)] hover:bg-black/60',
          // Shown on hover and focus, and while it is open, so the tiles stay clean.
          step ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 max-md:opacity-100',
        )}
      >
        <DotsThreeIcon size={18} weight="bold" aria-hidden />
      </button>
      {step === 'menu' && (
        <div role="menu" aria-label={format(t.moreFor, { name })} className="pop-in-end absolute end-0 top-full mt-1.5 flex w-44 flex-col rounded-card border surface-frost p-1 shadow-panel">
          <button type="button" role="menuitem" className={row} onClick={() => setStep('rename')}>{t.rename}</button>
          {duplicate && (
            <form action={duplicate}>
              <button type="submit" role="menuitem" className={row} onClick={() => setStep(null)}>{t.duplicate}</button>
            </form>
          )}
          <button type="button" role="menuitem" className={cn(row, 'text-danger')} onClick={() => setStep('delete')}>{t.delete}</button>
        </div>
      )}
      {step === 'rename' && (
        <form action={async (form) => { await rename(form); setStep(null) }} className="pop-in-end absolute end-0 top-full mt-1.5 flex w-64 flex-col gap-2 rounded-card border surface-frost p-3 shadow-panel">
          <label htmlFor="tile-rename" className="text-xs font-semibold text-muted">{t.newName}</label>
          <input
            id="tile-rename"
            name="name"
            required
            maxLength={120}
            defaultValue={name}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 min-w-0 rounded-row border border-line bg-bg px-2.5 text-[14px] outline-none hover:border-line-strong focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStep(null)} className={cn(buttonStyles({ variant: 'ghost' }), 'h-8 px-3')}>{t.cancel}</button>
            <Submit label={t.save} />
          </div>
        </form>
      )}
      {step === 'delete' && (
        <form action={remove} className="pop-in-end absolute end-0 top-full mt-1.5 flex w-64 flex-col gap-3 rounded-card border surface-frost p-3 shadow-panel">
          <p className="text-[13px] leading-snug">{format(t.deleteConfirm, { name })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setStep(null)} className={cn(buttonStyles({ variant: 'ghost' }), 'h-8 px-3')}>{t.cancel}</button>
            <Submit label={t.delete} danger />
          </div>
        </form>
      )}
    </div>
  )
}
