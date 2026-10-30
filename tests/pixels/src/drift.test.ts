import { describe, expect, it } from 'vitest'
import { driftProblem, limitFor, readDriftBaselines, type Drift } from './drift.ts'
import { loadFixtures } from './fixtures.ts'

const baseline = (drift: Drift) => ({ ...drift, limit: limitFor(drift) })

describe('WebGL drift limits', () => {
  it('passes drift at or under the limit', () => {
    const measured = { differing: 1000, percent: 13.4, maxDelta: 42 }
    expect(driftProblem(measured, baseline(measured))).toBeUndefined()
    expect(driftProblem({ differing: 1200, percent: 16.8, maxDelta: 58 }, baseline(measured))).toBeUndefined()
  })

  it('fails when more pixels differ than the limit allows', () => {
    const problem = driftProblem({ differing: 2000, percent: 20, maxDelta: 42 }, baseline({ differing: 1000, percent: 13.4, maxDelta: 42 }))
    expect(problem).toBe('20.000% of pixels differ, limit 16.8% (baseline 13.400%)')
  })

  it('fails when one channel moves too far, even on few pixels', () => {
    const problem = driftProblem({ differing: 10, percent: 0.001, maxDelta: 40 }, baseline({ differing: 252, percent: 0.022, maxDelta: 1 }))
    expect(problem).toBe('a channel differs by 40, limit 17 (baseline 1)')
  })

  it('a fixture with no drift may still drift a little', () => {
    expect(limitFor({ differing: 0, percent: 0, maxDelta: 0 })).toEqual({ percent: 0.05, maxDelta: 16 })
  })

  it('fails a case that has no baseline', () => {
    expect(driftProblem({ differing: 0, percent: 0, maxDelta: 0 }, undefined)).toMatch(/no baseline/)
  })

  it('every fixture page and format has a committed baseline', () => {
    const baselines = readDriftBaselines()
    const cases = loadFixtures().flatMap(({ name, json }) => {
      const design = json as { pages: Record<string, unknown>; formats: Record<string, unknown> }
      return Object.keys(design.pages).flatMap((p) => Object.keys(design.formats).map((f) => `${name} ${p}.${f}`))
    })
    expect(cases.filter((c) => !baselines[c])).toEqual([])
  })
})
