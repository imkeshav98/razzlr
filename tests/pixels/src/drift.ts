import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REFERENCE_DIR } from './pixels.ts'

/** How far the WebGL stage drew from the CPU export for one page in one format. */
export interface Drift {
  differing: number
  /** Share of pixels that differ, in percent. */
  percent: number
  /** Largest difference in any channel, 0–255. */
  maxDelta: number
}

/** A measured drift and the most a later run may show before CI fails. */
export interface DriftBaseline extends Drift {
  limit: { percent: number; maxDelta: number }
}

export const DRIFT_BASELINES = join(REFERENCE_DIR, 'webgl-drift.json')

/**
 * The limit set when a baseline is recorded: a quarter more than measured plus 0.05 percentage
 * points, and 16 levels more in any channel. Drift is the same run to run on SwiftShader, so this
 * leaves room for a small renderer change but not for a visible one. Limits can be edited by hand.
 */
export function limitFor(drift: Drift): DriftBaseline['limit'] {
  return {
    percent: Number((drift.percent * 1.25 + 0.05).toFixed(3)),
    maxDelta: Math.min(255, drift.maxDelta + 16),
  }
}

/** Why a drift fails its baseline, or undefined when it is within the limit. */
export function driftProblem(drift: Drift, baseline: DriftBaseline | undefined): string | undefined {
  if (!baseline) return 'no baseline; record one with UPDATE_DRIFT_BASELINES=1 and commit it'
  const problems = []
  if (drift.percent > baseline.limit.percent) {
    problems.push(`${drift.percent.toFixed(3)}% of pixels differ, limit ${baseline.limit.percent}% (baseline ${baseline.percent.toFixed(3)}%)`)
  }
  if (drift.maxDelta > baseline.limit.maxDelta) {
    problems.push(`a channel differs by ${drift.maxDelta}, limit ${baseline.limit.maxDelta} (baseline ${baseline.maxDelta})`)
  }
  return problems.length > 0 ? problems.join('; ') : undefined
}

export function readDriftBaselines(): Record<string, DriftBaseline> {
  try {
    return JSON.parse(readFileSync(DRIFT_BASELINES, 'utf8')) as Record<string, DriftBaseline>
  } catch {
    return {}
  }
}

/** Records one case's baseline, keeping the others; cases stay sorted so diffs are readable. */
export function recordDriftBaseline(name: string, drift: Drift) {
  const all = { ...readDriftBaselines(), [name]: { ...drift, percent: Number(drift.percent.toFixed(3)), limit: limitFor(drift) } }
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(DRIFT_BASELINES, `${JSON.stringify(sorted, null, 2)}\n`)
}
