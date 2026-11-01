import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One package in the pnpm workspace (not a Workspace; see GLOSSARY.md). */
export interface WorkspacePackage {
  name: string
  /** Path relative to the repo root, e.g. `apps/web` or `packages/schema`. */
  dir: string
  /** Workspace names this one depends on, from any dependency field. */
  deps: string[]
}

/** ADR-0001: each core package may depend only on those before it. */
const CORE_CHAIN = ['@dazbee/schema', '@dazbee/doc', '@dazbee/renderer', '@dazbee/editor']
const CHAIN_TEXT = CORE_CHAIN.map((name) => name.replace('@dazbee/', '')).join(' → ')

/** What a workspace root holds. Packages may never depend on apps or test suites. */
const ROOT_KINDS: Record<string, string> = { apps: 'an app', packages: 'a package', tests: 'a test suite' }
const kindOf = (w: WorkspacePackage) => ROOT_KINDS[w.dir.split('/')[0] ?? '']

export function findViolations(workspaces: WorkspacePackage[]): string[] {
  const byName = new Map(workspaces.map((w) => [w.name, w]))
  const violations: string[] = []
  for (const w of workspaces) {
    for (const dep of w.deps) {
      const target = byName.get(dep)
      if (!target) continue
      if (kindOf(w) === ROOT_KINDS.packages && kindOf(target) !== ROOT_KINDS.packages) {
        violations.push(`${w.name} (a package) depends on ${target.name} (${kindOf(target)})`)
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

/**
 * Reads the workspace packages named by `pnpm-workspace.yaml` under `root`.
 * Anything it can't check is reported as a problem, so the check never passes by seeing nothing.
 */
export function readWorkspaces(root: string): { workspaces: WorkspacePackage[]; problems: string[] } {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const packagesBlock = yaml.match(/^packages:\s*\n((?:[ \t]+-.*\n?)*)/m)?.[1] ?? ''
  const patterns = [...packagesBlock.matchAll(/^[ \t]+-[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/gm)].map((m) => m[1] as string)
  const workspaces: WorkspacePackage[] = []
  const problems: string[] = []
  for (const pattern of patterns) {
    const parent = pattern.match(/^([\w.-]+)\/\*$/)?.[1]
    if (!parent) {
      problems.push(`pnpm-workspace.yaml: cannot check the pattern "${pattern}"; use "dir/*"`)
      continue
    }
    if (!existsSync(join(root, parent))) continue
    for (const child of readdirSync(join(root, parent))) {
      const dir = `${parent}/${child}`
      const file = join(root, dir, 'package.json')
      if (!existsSync(file)) continue
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (typeof json.name !== 'string') {
        problems.push(`${dir}/package.json: missing "name"`)
        continue
      }
      const deps = DEP_FIELDS.flatMap((f) => Object.keys((json[f] as object | undefined) ?? {}))
      workspaces.push({ name: json.name, dir, deps })
    }
  }
  if (problems.length === 0 && workspaces.length === 0) {
    problems.push('pnpm-workspace.yaml: no workspace packages found')
  }
  return { workspaces, problems }
}

export function checkRepo(root: string): string[] {
  const { workspaces, problems } = readWorkspaces(root)
  return [...problems, ...findViolations(workspaces)]
}
