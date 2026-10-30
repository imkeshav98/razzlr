import { z } from 'zod'
import * as Y from 'yjs'
import { CommandError } from './command.ts'
import { COMMANDS, type CommandName } from './commands.ts'
import { root, type DesignDoc } from './design-doc.ts'
import { designView } from './design-view.ts'
import { migrateDoc } from './migrate.ts'

type InputOf<N extends CommandName> = z.input<(typeof COMMANDS)[N]['input']>
type ResultOf<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]['apply']>
/** A key a step changed and its value before; `restore` is false when there was no plain value to put back. */
type Replaced = { map: Y.Map<unknown>; key: string; oldValue: unknown; restore: boolean }

/**
 * One tab's handle on a design. Every change goes through `run`; one command is one undo step,
 * and undo only ever reverts this session's own commands, never changes that arrived from others.
 */
export function openSession(doc: DesignDoc) {
  const origin = { session: Symbol('session') }
  const r = root(doc)
  const roots = [r.meta, r.formats, r.pages, r.nodes, r.overrides]
  migrateDoc(doc)
  const view = designView(doc)
  const undoManager = new Y.UndoManager(roots, { trackedOrigins: new Set([origin]), captureTimeout: 0 })

  // Yjs gap: when a set of a key won over another tab's concurrent set, undoing it deletes the key
  // instead of restoring the value before it (both tabs overwrote that one). So every step on the
  // undo and redo stacks remembers the values its transaction replaced, and undo or redo puts back
  // any that went missing. This is the one write outside a command (ADR-0004): it only restores a
  // value this tab saw, in an untracked transaction that never lands on either stack.
  let pending: Replaced[] = []
  const collect = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin !== origin && tr.origin !== undoManager) return
    for (const event of events) {
      if (!(event.target instanceof Y.Map)) continue
      for (const [key, change] of event.changes.keys) {
        // A key the step added is recorded too, so a gesture that adds a key and then changes it
        // doesn't put its own in-between value back after undo deletes the key.
        const restore = change.action !== 'add' && change.oldValue !== undefined && !(change.oldValue instanceof Y.AbstractType)
        pending.push({ map: event.target, key, oldValue: change.oldValue, restore })
      }
    }
  }
  for (const type of roots) type.observeDeep(collect)
  const onStackItemAdded = ({ stackItem }: { stackItem: { meta: Map<string, unknown> } }) => {
    stackItem.meta.set('replaced', pending)
    pending = []
  }
  // Inside a gesture, later commands merge into the gesture's one step. Its first replaced value
  // for each key is the one from before the gesture, so later ones are not kept.
  const onStackItemUpdated = ({ stackItem }: { stackItem: { meta: Map<string, unknown> } }) => {
    const replaced = (stackItem.meta.get('replaced') ?? []) as Replaced[]
    for (const r of pending) if (!replaced.some((x) => x.map === r.map && x.key === r.key)) replaced.push(r)
    stackItem.meta.set('replaced', replaced)
    pending = []
  }
  undoManager.on('stack-item-added', onStackItemAdded)
  undoManager.on('stack-item-updated', onStackItemUpdated)

  const repairOrigin = { restoreAfterUndo: true }
  const stepThen = (stack: { meta: Map<string, unknown> }[], step: () => void) => {
    const restore = (stack.at(-1)?.meta.get('replaced') ?? []) as Replaced[]
    pending = []
    step()
    // `_item` is the map's place in the doc; a map removed by this step has nothing to restore into.
    const missing = restore.filter(({ map, key, restore }) => restore && !map.has(key) && !map._item?.deleted)
    if (missing.length > 0) doc.transact(() => missing.forEach(({ map, key, oldValue }) => map.set(key, oldValue)), repairOrigin)
  }

  function run<N extends CommandName>(name: N, input: InputOf<N>): ResultOf<N> {
    const command = COMMANDS[name]
    const parsed = command.input.safeParse(input)
    if (!parsed.success) {
      throw new CommandError(name, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    }
    // A document saved at an older schema version is brought up to this one before it is changed;
    // a session opened before the document arrived from the server meets it here.
    migrateDoc(doc)
    const ctx = { doc, r, design: view.read() }
    const reason = command.check?.(ctx, parsed.data as never)
    if (reason) throw new CommandError(name, reason)
    let result: unknown
    pending = []
    doc.transact(() => {
      result = command.apply(ctx, parsed.data as never)
    }, origin)
    if (!inGesture) undoManager.stopCapturing()
    return result as ResultOf<N>
  }

  let inGesture = false
  /**
   * Starts one undo step that lasts until the returned function is called: every command run in
   * between, such as each move of a drag or each key typed into a text, is undone together.
   * Commands from other tabs are never part of it.
   */
  function beginGesture(): () => void {
    if (inGesture) return () => {}
    undoManager.stopCapturing()
    inGesture = true
    undoManager.captureTimeout = Number.POSITIVE_INFINITY
    return () => {
      inGesture = false
      undoManager.captureTimeout = 0
      undoManager.stopCapturing()
    }
  }

  /** Runs `steps` as one gesture. */
  function gesture<T>(steps: () => T): T {
    const end = beginGesture()
    try {
      return steps()
    } finally {
      end()
    }
  }

  return {
    run,
    beginGesture,
    gesture,
    undo: () => stepThen(undoManager.undoStack, () => undoManager.undo()),
    redo: () => stepThen(undoManager.redoStack, () => undoManager.redo()),
    canUndo: () => undoManager.canUndo(),
    /**
     * The design, validated. It is live: it always shows the document as it is now, and can't be
     * changed through. Its layers and override values are frozen and replaced when they change.
     */
    design: () => view.read(),
    destroy: () => {
      view.destroy()
      for (const type of roots) type.unobserveDeep(collect)
      undoManager.off('stack-item-added', onStackItemAdded)
      undoManager.off('stack-item-updated', onStackItemUpdated)
      undoManager.destroy()
    },
  }
}
export type Session = ReturnType<typeof openSession>
