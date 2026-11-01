import type { Design } from '@dazbee/schema'
import type * as Y from 'yjs'
import type { CommandContext } from './command.ts'
import { overrideKey } from './design-doc.ts'
import { round, type Box } from './geometry.ts'

/** Where a layer is in one scope, and whether it shows there. */
export type Placed = Box & { visible: boolean }
type Path = keyof Placed

/** `base`, or `format:<id>` for one format's overrides. */
export type ScopeKey = 'base' | `format:${string}`

const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b)

/**
 * Plans where layers should be in every scope, then writes the plan as base values plus only the
 * overrides each format needs to show what was planned for it. Commands that must keep layers
 * where they are on screen in every format (group, ungroup, hug) plan each scope on its own,
 * from what that scope shows now.
 */
export class Placement {
  private readonly want = new Map<ScopeKey, Map<string, Partial<Placed>>>()
  private readonly design: Design

  constructor(design: Design) {
    this.design = design
  }

  get scopes(): ScopeKey[] {
    return ['base', ...Object.keys(this.design.formats).map((id) => `format:${id}` as const)]
  }

  /** What a scope shows now: the base with the scope's overrides. */
  private shown(scope: ScopeKey, id: string): Placed {
    const node = this.design.nodes[id]
    const p = { ...node?.props, ...(scope === 'base' ? {} : this.design.overrides[scope]?.[id]) } as Partial<Placed>
    return { x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? 0, height: p.height ?? 0, rotation: p.rotation ?? 0, visible: p.visible ?? true }
  }

  /** A layer in a scope, with what has been planned for it so far. */
  get(scope: ScopeKey, id: string): Placed {
    return { ...this.shown(scope, id), ...this.want.get(scope)?.get(id) }
  }

  set(scope: ScopeKey, id: string, patch: Partial<Placed>) {
    const byId = this.want.get(scope) ?? new Map<string, Partial<Placed>>()
    this.want.set(scope, byId)
    const rounded = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
    byId.set(id, { ...byId.get(id), ...rounded })
  }

  /**
   * Writes the plan: base values first, then for each format an override wherever the format
   * would otherwise show something other than planned. A layer a base change moves gets an
   * override in a format that had no plan to move it.
   */
  write(r: CommandContext['r']) {
    const base = this.want.get('base') ?? new Map<string, Partial<Placed>>()
    for (const [id, patch] of base) {
      const props = r.nodes.get(id)?.get('props') as Y.Map<unknown> | undefined
      for (const [path, value] of Object.entries(patch)) if (!same(this.shown('base', id)[path as Path], value)) props?.set(path, value)
    }
    for (const scope of this.scopes) {
      if (scope === 'base') continue
      const planned = this.want.get(scope)
      for (const id of new Set([...base.keys(), ...(planned?.keys() ?? [])])) {
        const paths = new Set([...Object.keys(base.get(id) ?? {}), ...Object.keys(planned?.get(id) ?? {})]) as Set<Path>
        const overridden = this.design.overrides[scope]?.[id] as Partial<Placed> | undefined
        const next = this.get(scope, id)
        for (const path of paths) {
          const shows = overridden?.[path] ?? base.get(id)?.[path] ?? this.shown('base', id)[path]
          if (!same(shows, next[path])) r.overrides.set(overrideKey(scope, id, path), next[path])
        }
      }
    }
  }
}
