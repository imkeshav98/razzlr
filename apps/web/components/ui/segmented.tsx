// A small pill of two or three choices, as the final mock draws language and theme in the account
// menu: each choice in words, the picked one on a soft pink.
import { cn } from '../../lib/cn.ts'

export const SEGMENTED = 'flex items-center gap-0.5 rounded-full border border-line p-0.5'

export const segment = (on: boolean) => cn(
  'h-7 cursor-pointer rounded-full px-2.5 text-[12px] font-semibold transition-colors duration-[var(--chrome-fast)]',
  on ? 'bg-accent-soft text-text' : 'text-subtle hover:text-text',
)
