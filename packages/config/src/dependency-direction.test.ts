import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRepo, findViolations, type WorkspacePackage } from './dependency-direction.ts'

const workspacePackage = (name: string, dir: string, deps: string[] = []): WorkspacePackage => ({ name, dir, deps })

describe('dependency direction', () => {
  it('flags a package that depends on an app', () => {
    const violations = findViolations([
      workspacePackage('@razzlr/web', 'apps/web'),
      workspacePackage('@razzlr/schema', 'packages/schema', ['@razzlr/web']),
    ])
    expect(violations).toEqual(['@razzlr/schema (a package) depends on @razzlr/web (an app)'])
  })

  it('flags a package that depends on a test suite', () => {
    const violations = findViolations([
      workspacePackage('@razzlr/e2e', 'tests/e2e'),
      workspacePackage('@razzlr/doc', 'packages/doc', ['@razzlr/e2e']),
    ])
    expect(violations).toEqual(['@razzlr/doc (a package) depends on @razzlr/e2e (a test suite)'])
  })

  it('flags a core package that depends on one later in schema → doc → renderer → editor', () => {
    const violations = findViolations([
      workspacePackage('@razzlr/schema', 'packages/schema', ['@razzlr/renderer']),
      workspacePackage('@razzlr/renderer', 'packages/renderer'),
    ])
    expect(violations).toEqual([
      '@razzlr/schema depends on @razzlr/renderer, which comes later in schema → doc → renderer → editor',
    ])
  })

  it('allows core packages to depend downward and apps and tests to depend on anything below them', () => {
    const violations = findViolations([
      workspacePackage('@razzlr/schema', 'packages/schema'),
      workspacePackage('@razzlr/doc', 'packages/doc', ['@razzlr/schema']),
      workspacePackage('@razzlr/renderer', 'packages/renderer', ['@razzlr/doc', '@razzlr/schema', '@razzlr/fonts']),
      workspacePackage('@razzlr/fonts', 'packages/fonts'),
      workspacePackage('@razzlr/editor', 'packages/editor', ['@razzlr/renderer']),
      workspacePackage('@razzlr/web', 'apps/web', ['@razzlr/editor']),
      workspacePackage('@razzlr/e2e', 'tests/e2e', ['@razzlr/web']),
    ])
    expect(violations).toEqual([])
  })
})

describe('checkRepo', () => {
  let root: string
  const repo = (workspaceYaml: string) => {
    root = mkdtempSync(join(tmpdir(), 'razzlr-deps-'))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), workspaceYaml)
  }
  const pkg = (dir: string, json: object) => {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(json))
  }
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads every workspace listed in pnpm-workspace.yaml and checks all dependency fields', () => {
    repo('packages:\n  - apps/*\n  - packages/*\n')
    pkg('apps/web', { name: '@razzlr/web' })
    pkg('packages/doc', { name: '@razzlr/doc', devDependencies: { '@razzlr/web': 'workspace:*' } })

    expect(checkRepo(root)).toEqual(['@razzlr/doc (a package) depends on @razzlr/web (an app)'])
  })

  it('fails instead of passing when a workspace pattern is not understood', () => {
    repo('packages:\n  - apps/*\n  - packages/**\n')
    pkg('apps/web', { name: '@razzlr/web' })

    expect(checkRepo(root)).toEqual(['pnpm-workspace.yaml: cannot check the pattern "packages/**"; use "dir/*"'])
  })

  it('fails instead of passing when no workspace packages are found', () => {
    repo('packages:\n  - apps/*\n')

    expect(checkRepo(root)).toEqual(['pnpm-workspace.yaml: no workspace packages found'])
  })

  it('fails when a workspace package has no name', () => {
    repo('packages:\n  - apps/*\n')
    pkg('apps/web', {})

    expect(checkRepo(root)).toEqual(['apps/web/package.json: missing "name"'])
  })
})
