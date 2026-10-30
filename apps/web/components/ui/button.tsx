import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export const buttonStyles = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-row font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,color,box-shadow,transform] duration-[var(--chrome-fast)] ease-[var(--ease-out)] ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent-solid text-on-accent shadow-[0_1px_0_rgb(255_255_255/0.18)_inset] hover:bg-accent-solid-hover',
        secondary: 'border border-line bg-raised text-text hover:border-line-strong hover:bg-hover',
        ghost: 'text-muted hover:bg-hover hover:text-text',
      },
      size: {
        md: 'h-[var(--row)] px-3 text-[13px]',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-[var(--row)] text-[13px]',
        rail: 'size-10',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export function Button({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button type="button" className={cn(buttonStyles({ variant, size }), className)} {...props} />
}
