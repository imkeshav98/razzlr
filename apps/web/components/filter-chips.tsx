// A row of filter chips, as on the earlier mock's pages: each a link, so the filter lives in the
// address and works before any script loads.
import Link from 'next/link'
import { cn } from '../lib/cn.ts'

export function FilterChips({ label, chips }: { label: string; chips: { label: string; href: string; on: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          scroll={false}
          aria-current={chip.on ? 'page' : undefined}
          className={cn(
            'inline-flex h-9 items-center rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold transition-colors duration-[var(--chrome-fast)]',
            chip.on ? 'border-accent bg-accent-soft text-text' : 'border-line text-muted hover:border-line-strong hover:text-text',
          )}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  )
}
