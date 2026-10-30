import { z } from 'zod'
import * as Y from 'yjs'
import { CommandError } from './command.ts'
import { COMMANDS, type CommandName } from './commands.ts'
import { readDesign, root, type DesignDoc } from './design-doc.ts'

type InputOf<N extends CommandName> = z.input<(typeof COMMANDS)[N]['input']>
type ResultOf<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]['apply']>

/**
 * One tab's handle on a design. Every change goes through `run`; one command is one undo step,
 * and undo only ever reverts this session's own commands, never changes that arrived from others.
 */
export function openSession(doc: DesignDoc) {
  const origin = { session: Symbol('session') }
  const r = root(doc)
  const roots = [r.meta, r.formats, r.pages, r.nodes, r.overrides]
  const undoManager = new Y.UndoManager(roots, { trackedOrigins: new Set([origin]), captureTimeout: 0 })

  // Yjs gap: when this tab's set of a key won over another tab's concurrent set, undoing it deletes
  // the key rather than restoring the value before it (both tabs overwrote that one). So each command
  // remembers the values it replaced, and undo puts back any that went missing, in an untracked
  // transaction so it never lands on either undo stack.
  type Replaced = { map: Y.Map<unknown>; key: string; oldValue: unknown }
  let replaced: Replaced[] = []
  const collect = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin !== origin) return
    for (const event of events) {
      if (!(event.target instanceof Y.Map)) continue
      for (const [key, change] of event.changes.keys) {
        if (change.action !== 'add' && change.oldValue !== undefined && !(change.oldValue instanceof Y.AbstractType)) {
          replaced.push({ map: event.target, key, oldValue: change.oldValue })
        }
      }
    }
  }
  for (const type of roots) type.observeDeep(collect)
  const repairOrigin = { repairAfterUndo: true }

  function run<N extends CommandName>(name: N, input: InputOf<N>): ResultOf<N> {
    const command = COMMANDS[name]
    const parsed = command.input.safeParse(input)
    if (!parsed.success) {
      throw new CommandError(name, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    }
    const ctx = { doc, r, design: readDesign(doc) }
    const reason = command.check?.(ctx, parsed.data as never)
    if (reason) throw new CommandError(name, reason)
    let result: unknown
    replaced = []
    doc.transact(() => {
      result = command.apply(ctx, parsed.data as never)
    }, origin)
    undoManager.undoStack.at(-1)?.meta.set('replaced', replaced)
    undoManager.stopCapturing()
    return result as ResultOf<N>
  }

  return {
    run,
    undo: () => {
      const restore = (undoManager.undoStack.at(-1)?.meta.get('replaced') ?? []) as Replaced[]
      undoManager.undo()
      const missing = restore.filter(({ map, key }) => !map.has(key) && !map._item?.deleted)
      if (missing.length > 0) doc.transact(() => missing.forEach(({ map, key, oldValue }) => map.set(key, oldValue)), repairOrigin)
    },
    redo: () => void undoManager.redo(),
    canUndo: () => undoManager.canUndo(),
    destroy: () => {
      for (const type of roots) type.unobserveDeep(collect)
      undoManager.destroy()
    },
  }
}
export type Session = ReturnType<typeof openSession>
