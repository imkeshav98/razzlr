import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRepo, findViolations, type Workspace } from './dependency-direction.ts'

const ws = (name: string, dir: string, deps: string[] = []): Workspace => ({ name, dir, deps })

describe('dependency direction', () => {
  it('flags a package that depends on an app', () => {
    const violations = findViolations([
      ws('@razzlr/web', 'apps/web'),
      ws('@razzlr/schema', 'packages/schema', ['@razzlr/web']),
    ])
    expect(violations).toEqual(['@razzlr/schema (a package) depends on the app @razzlr/web'])
  })

  it('flags a core package that depends on one later in schema → doc → renderer → editor', () => {
    const violations = findViolations([
      ws('@razzlr/schema', 'packages/schema', ['@razzlr/renderer']),
      ws('@razzlr/renderer', 'packages/renderer'),
    ])
    expect(violations).toEqual([
      '@razzlr/schema depends on @razzlr/renderer, which comes later in schema → doc → renderer → editor',
    ])
  })

  it('allows core packages to depend downward and apps to depend on packages', () => {
    const violations = findViolations([
      ws('@razzlr/schema', 'packages/schema'),
      ws('@razzlr/doc', 'packages/doc', ['@razzlr/schema']),
      ws('@razzlr/renderer', 'packages/renderer', ['@razzlr/doc', '@razzlr/schema', '@razzlr/fonts']),
      ws('@razzlr/fonts', 'packages/fonts'),
      ws('@razzlr/editor', 'packages/editor', ['@razzlr/renderer']),
      ws('@razzlr/web', 'apps/web', ['@razzlr/editor']),
    ])
    expect(violations).toEqual([])
  })
})

describe('checkRepo', () => {
  it('reads every workspace listed in pnpm-workspace.yaml and checks all dependency fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'razzlr-deps-'))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')
    const pkg = (dir: string, json: object) => {
      mkdirSync(join(root, dir), { recursive: true })
      writeFileSync(join(root, dir, 'package.json'), JSON.stringify(json))
    }
    pkg('apps/web', { name: '@razzlr/web' })
    pkg('packages/doc', { name: '@razzlr/doc', devDependencies: { '@razzlr/web': 'workspace:*' } })

    expect(checkRepo(root)).toEqual(['@razzlr/doc (a package) depends on the app @razzlr/web'])
  })
})
