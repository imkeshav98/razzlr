import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Drift, DriftBaseline } from '../../src/drift.ts'
import { OUTPUT_DIR } from '../../src/pixels.ts'

export const BROWSER_OUT = join(OUTPUT_DIR, 'browser')
const ROWS = join(OUTPUT_DIR, 'webgl-rows')
const REPORT = join(OUTPUT_DIR, 'webgl-vs-cpu.md')

export interface DriftRow extends Drift { case: string; limit?: DriftBaseline['limit']; problem?: string }

/** Each test writes its own row, so a worker restart after a failure loses nothing. */
export function saveDriftRow(row: DriftRow) {
  mkdirSync(ROWS, { recursive: true })
  writeFileSync(join(ROWS, `${row.case.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(row))
}

export function clearBrowserOutput() {
  for (const dir of [BROWSER_OUT, ROWS]) rmSync(dir, { recursive: true, force: true })
  rmSync(REPORT, { force: true })
}

/** The WebGL drift table, written to output/, the CI step summary and the log. */
export function writeDriftReport() {
  let files: string[] = []
  try {
    files = readdirSync(ROWS).sort()
  } catch {
    return
  }
  const rows = files.map((f) => JSON.parse(readFileSync(join(ROWS, f), 'utf8')) as DriftRow)
    .map((r) => {
      const limit = r.limit ? `${r.limit.percent}%, ${r.limit.maxDelta}` : 'none'
      return `| ${r.case} | ${r.differing} | ${r.percent.toFixed(3)}% | ${r.maxDelta} | ${limit} | ${r.problem ? `**Fail**: ${r.problem}` : 'Pass'} |`
    })
  const table = [
    '| Page in format | Differing pixels | Share | Largest channel difference | Limit (share, channel) | Result |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
  writeFileSync(REPORT, `# WebGL vs CPU in Chromium\n\n${table}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## WebGL vs CPU in Chromium\n\n${table}\n`, { flag: 'a' })
  console.log(`\nWebGL vs CPU in Chromium\n${table}`)
}
