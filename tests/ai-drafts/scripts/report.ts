// Sums up a run of the AI draft test (#24): every measure per path, per image model and per
// script, as Markdown tables for docs/spike/ai-draft-test.md and as runs/summary.json.
//   pnpm report
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ledger, RUNS_DIR } from '../src/gemini.ts'
import type { Match } from '../src/match.ts'

interface Fit { overflows: boolean; missing: string[]; scale: number }
interface Result {
  adId: string; language: 'en' | 'hi' | 'ar'; model: string; texts: string[]
  flat: {
    draftSeconds: number; draftCostUsd: number; asDrawn: Match
    editable: { live: boolean[]; strayLive: string[]; cutouts: string[]; fits: Fit[]; layeringSeconds: number; layeringCostUsd: number }
    fidelity: { score: number; differences: string }
  }
  hybrid: {
    seconds: number; costUsd: number; missing: number[]; invented: string[]; fits: Fit[]
    contrast: { median: number; under3: number }[]; asDrawn: Match; pictureText: string[]
  }
  look: { winner: 'flat' | 'hybrid' | 'tie' }
}

const results: Result[] = readdirSync(RUNS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'cache')
  .flatMap((d) => readdirSync(join(RUNS_DIR, d.name)).map((m) => join(RUNS_DIR, d.name, m, 'result.json')))
  .filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Result)

const allFound = (m: Match) => m.found.every(Boolean)
/** What the user sees when choosing: every text right, nothing else written. */
const flatAsDrawn = (r: Result) => allFound(r.flat.asDrawn) && r.flat.asDrawn.stray.length === 0
/** The brief's measure after layering: every intended text a live layer, no other text left, as a layer or a cut-out. */
const flatEditable = (r: Result) => r.flat.editable.live.every(Boolean) && r.flat.editable.strayLive.length === 0 && r.flat.editable.cutouts.length === 0
/** The brief's measure for a hybrid draft: every text placed, none overflowing, no stray text visible in the picture. */
const hybridPass = (r: Result) => r.hybrid.missing.length === 0 && r.hybrid.fits.every((f) => !f.overflows) && r.hybrid.asDrawn.stray.length === 0

const pct = (n: number, d: number) => d === 0 ? '–' : `${Math.round((100 * n) / d)}% (${n}/${d})`
const mean = (xs: number[]) => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

const models = [...new Set(results.map((r) => r.model))].sort()
const groups: [string, (r: Result) => boolean][] = [
  ['All', () => true], ['English', (r) => r.language === 'en'], ['Hindi', (r) => r.language === 'hi'], ['Arabic', (r) => r.language === 'ar'],
]
const lines: string[] = []
const table = (head: string[], rows: string[][]) => {
  lines.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`), '')
}

for (const model of models) {
  const mine = results.filter((r) => r.model === model)
  lines.push(`### ${model}`, '')
  table(['Ads', 'Flat, as drawn', 'Flat, after layering', 'Flat, both', 'Hybrid'], groups.map(([name, keep]) => {
    const rs = mine.filter(keep)
    return [
      `${name} (${rs.length})`,
      pct(rs.filter(flatAsDrawn).length, rs.length),
      pct(rs.filter(flatEditable).length, rs.length),
      pct(rs.filter((r) => flatAsDrawn(r) && flatEditable(r)).length, rs.length),
      pct(rs.filter(hybridPass).length, rs.length),
    ]
  }))
  const texts = mine.flatMap((r) => r.flat.asDrawn.found)
  const hybridTexts = mine.flatMap((r) => r.hybrid.asDrawn.found)
  const contrasts = mine.flatMap((r) => r.hybrid.contrast)
  const hybridFits = mine.flatMap((r) => r.hybrid.fits)
  table(['Detail', 'Value'], [
    ['Flat: texts drawn right', pct(texts.filter(Boolean).length, texts.length)],
    ['Flat: drafts with stray or invented text', pct(mine.filter((r) => r.flat.asDrawn.stray.length > 0).length, mine.length)],
    ['Flat: drafts where some text stayed a picture', pct(mine.filter((r) => r.flat.editable.cutouts.length > 0).length, mine.length)],
    ['Flat: editable still looks like the draft (judge, 1–5)', `mean ${mean(mine.map((r) => r.flat.fidelity.score)).toFixed(1)}`],
    ['Reader error on hybrid texts we drew (should be 0)', pct(hybridTexts.filter((f) => !f).length, hybridTexts.length)],
    ['Hybrid: texts the planner left out', String(mine.reduce((n, r) => n + r.hybrid.missing.length, 0))],
    ['Hybrid: texts shrunk below 80% to fit', pct(hybridFits.filter((f) => f.scale < 0.8).length, hybridFits.length)],
    ['Hybrid: texts drawn partly in a fallback font', pct(hybridFits.filter((f) => f.missing.length > 0).length, hybridFits.length)],
    ['Hybrid: texts under 3:1 contrast (median)', pct(contrasts.filter((c) => c.median < 3).length, contrasts.length)],
    ['Hybrid: pictures with text painted in', pct(mine.filter((r) => r.hybrid.pictureText.length > 0).length, mine.length)],
    ['Look judge: flat / hybrid / tie', ['flat', 'hybrid', 'tie'].map((w) => mine.filter((r) => r.look.winner === w).length).join(' / ')],
    ['Seconds: flat draft (median)', median(mine.map((r) => r.flat.draftSeconds)).toFixed(1)],
    ['Seconds: flat text layering steps here (median)', median(mine.map((r) => r.flat.editable.layeringSeconds)).toFixed(1)],
    ['Seconds: hybrid draft, all steps (median)', median(mine.map((r) => r.hybrid.seconds)).toFixed(1)],
    ['Cost per flat draft + layering here (mean)', `$${mean(mine.map((r) => r.flat.draftCostUsd + r.flat.editable.layeringCostUsd)).toFixed(3)}`],
    ['Cost per hybrid draft (mean)', `$${mean(mine.map((r) => r.hybrid.costUsd)).toFixed(3)}`],
  ])
}
lines.push(`Total spent on the run: $${ledger().reduce((s, e) => s + e.costUsd, 0).toFixed(2)} over ${ledger().length} calls.`)

console.log(lines.join('\n'))
writeFileSync(join(RUNS_DIR, 'summary.md'), lines.join('\n'))
