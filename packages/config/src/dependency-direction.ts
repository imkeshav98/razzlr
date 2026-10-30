import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Workspace {
  name: string
  /** Path relative to the repo root, e.g. `apps/web` or `packages/schema`. */
  dir: string
  /** Workspace names this one depends on, from any dependency field. */
  deps: string[]
}

/** ADR-0001: each core package may depend only on those before it. */
const CORE_CHAIN = ['@razzlr/schema', '@razzlr/doc', '@razzlr/renderer', '@razzlr/editor']
const CHAIN_TEXT = 'schema → doc → renderer → editor'

const isApp = (w: Workspace) => w.dir.startsWith('apps/')
const isPackage = (w: Workspace) => w.dir.startsWith('packages/')

export function findViolations(workspaces: Workspace[]): string[] {
  const byName = new Map(workspaces.map((w) => [w.name, w]))
  const violations: string[] = []
  for (const w of workspaces) {
    for (const dep of w.deps) {
      const target = byName.get(dep)
      if (!target) continue
      if (isPackage(w) && isApp(target)) {
        violations.push(`${w.name} (a package) depends on the app ${target.name}`)
      }
      const from = CORE_CHAIN.indexOf(w.name)
      const to = CORE_CHAIN.indexOf(target.name)
      if (from !== -1 && to > from) {
        violations.push(`${w.name} depends on ${target.name}, which comes later in ${CHAIN_TEXT}`)
      }
    }
  }
  return violations
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** Reads the workspaces named by `pnpm-workspace.yaml` (only `dir/*` globs) under `root`. */
export function readWorkspaces(root: string): Workspace[] {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const parents = [...yaml.matchAll(/^\s*-\s*['"]?([\w.-]+)\/\*['"]?\s*$/gm)].map((m) => m[1] as string)
  const workspaces: Workspace[] = []
  for (const parent of parents) {
    if (!existsSync(join(root, parent))) continue
    for (const child of readdirSync(join(root, parent))) {
      const file = join(root, parent, child, 'package.json')
      if (!existsSync(file)) continue
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const deps = DEP_FIELDS.flatMap((f) => Object.keys((json[f] as object | undefined) ?? {}))
      workspaces.push({ name: json.name as string, dir: `${parent}/${child}`, deps })
    }
  }
  return workspaces
}

export function checkRepo(root: string): string[] {
  return findViolations(readWorkspaces(root))
}
