import type { Design } from '@dazbee/schema'
import type { z } from 'zod'
import { root, type DesignDoc } from './design-doc.ts'

export interface CommandContext {
  doc: DesignDoc
  r: ReturnType<typeof root>
  /** The design as it was before this command, validated. */
  design: Design
}

/**
 * One way to change a design (ADR-0004). `check` sees the validated design and returns a reason
 * to refuse; `apply` then writes inside one transaction and must not throw, since Yjs can't roll back.
 */
export interface Command<I extends z.ZodType, R> {
  name: string
  input: I
  check?: (ctx: CommandContext, input: z.output<I>) => string | undefined
  apply: (ctx: CommandContext, input: z.output<I>) => R
}

export const defineCommand = <I extends z.ZodType, R>(command: Command<I, R>) => command

export class CommandError extends Error {
  constructor(command: string, reason: string) {
    super(`${command}: ${reason}`)
    this.name = 'CommandError'
  }
}
