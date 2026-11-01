import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRepo, findViolations, type WorkspacePackage } from './dependency-direction.ts'

const workspacePackage = (name: string, dir: string, deps: string[] = []): WorkspacePackage => ({ name, dir, deps })

describe('dependency direction', () => {
  it('flags a package that depends on an app', () => {
    const violations = findViolations([
      workspacePackage('@dazbee/web', 'apps/web'),
      workspacePackage('@dazbee/schema', 'packages/schema', ['@dazbee/web']),
    ])
    expect(violations).toEqual(['@dazbee/schema (a package) depends on @dazbee/web (an app)'])
  })

  it('flags a package that depends on a test suite', () => {
    const violations = findViolations([
      workspacePackage('@dazbee/e2e', 'tests/e2e'),
      workspacePackage('@dazbee/doc', 'packages/doc', ['@dazbee/e2e']),
    ])
    expect(violations).toEqual(['@dazbee/doc (a package) depends on @dazbee/e2e (a test suite)'])
  })

  it('flags a core package that depends on one later in schema → doc → renderer → editor', () => {
    const violations = findViolations([
      workspacePackage('@dazbee/schema', 'packages/schema', ['@dazbee/renderer']),
      workspacePackage('@dazbee/renderer', 'packages/renderer'),
    ])
    expect(violations).toEqual([
      '@dazbee/schema depends on @dazbee/renderer, which comes later in schema → doc → renderer → editor',
    ])
  })

  it('allows core packages to depend downward and apps and tests to depend on anything below them', () => {
    const violations = findViolations([
      workspacePackage('@dazbee/schema', 'packages/schema'),
      workspacePackage('@dazbee/doc', 'packages/doc', ['@dazbee/schema']),
      workspacePackage('@dazbee/renderer', 'packages/renderer', ['@dazbee/doc', '@dazbee/schema', '@dazbee/fonts']),
      workspacePackage('@dazbee/fonts', 'packages/fonts'),
      workspacePackage('@dazbee/editor', 'packages/editor', ['@dazbee/renderer']),
      workspacePackage('@dazbee/web', 'apps/web', ['@dazbee/editor']),
      workspacePackage('@dazbee/e2e', 'tests/e2e', ['@dazbee/web']),
    ])
    expect(violations).toEqual([])
  })
})

describe('checkRepo', () => {
  let root: string
  const repo = (workspaceYaml: string) => {
    root = mkdtempSync(join(tmpdir(), 'dazbee-deps-'))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), workspaceYaml)
  }
  const pkg = (dir: string, json: object) => {
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(json))
  }
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads every workspace listed in pnpm-workspace.yaml and checks all dependency fields', () => {
    repo('packages:\n  - apps/*\n  - packages/*\n')
    pkg('apps/web', { name: '@dazbee/web' })
    pkg('packages/doc', { name: '@dazbee/doc', devDependencies: { '@dazbee/web': 'workspace:*' } })

    expect(checkRepo(root)).toEqual(['@dazbee/doc (a package) depends on @dazbee/web (an app)'])
  })

  it('fails instead of passing when a workspace pattern is not understood', () => {
    repo('packages:\n  - apps/*\n  - packages/**\n')
    pkg('apps/web', { name: '@dazbee/web' })

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
