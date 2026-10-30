'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={350} skipDelayDuration={150}>{children}</RadixTooltip.Provider>
)

/** A short label beside a control; the control must carry its own accessible name too. */
export function Tooltip({ label, side = 'top', children }: { label: string; side?: 'top' | 'right' | 'bottom' | 'left'; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-md border border-line bg-raised px-2 py-1 text-xs font-medium text-text shadow-panel data-[state=delayed-open]:animate-[tooltip-in_var(--chrome-fast)_var(--ease-out)]"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
