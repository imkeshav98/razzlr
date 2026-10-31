// Who Razzlr is for (#109), as three big cards: Just me, My company, My clients. They are radio
// buttons in a form, so they work before any script loads. Onboarding asks once; settings shows
// the same cards to change it later. The answer changes only words and defaults (ADR-0011).
import { BuildingsIcon, CheckIcon, UserIcon, UsersThreeIcon } from '@phosphor-icons/react/ssr'
import type { WorkspaceKind } from '@razzlr/schema'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { Messages } from '../lib/i18n/index.ts'

const KINDS = [
  { kind: 'solo', Icon: UserIcon },
  { kind: 'company', Icon: BuildingsIcon },
  { kind: 'agency', Icon: UsersThreeIcon },
] as const

export function KindCards({ t, current, action, legend, children }: {
  t: Messages
  /** The kind picked now, if any. */
  current?: WorkspaceKind
  action: (form: FormData) => Promise<void>
  legend: string
  /** The submit row. */
  children: ReactNode
}) {
  return (
    <form action={action}>
      <fieldset>
        <legend className="sr-only">{legend}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {KINDS.map(({ kind, Icon }, i) => {
            const words = t.welcome.kinds[kind]
            return (
              <label
                key={kind}
                data-testid={`kind-${kind}`}
                className={cn(
                  // The final mock's dark panels: a solid card, a hairline edge, a big bold title.
                  'rise group relative flex cursor-pointer flex-col gap-2 rounded-[18px] border border-line bg-raised p-5 transition-[border-color,transform,box-shadow] duration-[var(--chrome)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-line-strong md:p-6 sm:min-h-56',
                  'has-[:checked]:border-accent has-[:checked]:shadow-[0_0_0_1px_var(--accent),0_18px_44px_-18px_var(--accent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ring',
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <input type="radio" name="kind" value={kind} defaultChecked={current === kind} required className="sr-only" />
                <span aria-hidden className="absolute end-5 top-5 grid size-7 scale-75 place-items-center rounded-full bg-accent-solid text-on-accent opacity-0 transition-[opacity,transform] duration-[var(--chrome)] ease-[var(--ease-out)] group-has-[:checked]:scale-100 group-has-[:checked]:opacity-100 md:end-6 md:top-6">
                  <CheckIcon size={15} weight="bold" />
                </span>
                <span className="pe-9 font-display text-2xl font-bold tracking-tight md:text-[1.75rem] md:leading-tight">{words.title}</span>
                <span className="text-sm text-muted text-pretty">{words.body}</span>
                <span aria-hidden className="mt-3 grid size-12 place-items-center sm:mt-auto rounded-[14px] border border-line text-muted transition-colors duration-[var(--chrome)] group-has-[:checked]:border-transparent group-has-[:checked]:bg-accent-soft group-has-[:checked]:text-accent-text">
                  <Icon size={26} weight="duotone" />
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      {children}
    </form>
  )
}
