// The canvas gesture matrix (#232) in the square, the primary format: every canvas gesture
// against every kind of container, checked against what it should do (support/gesture-matrix.ts).
// The table of results is written to output/gesture-matrix-sq.md.
import { expect, test } from '../support/test.ts'
import { writeOutput } from '../support/editor.ts'
import { runMatrix } from '../support/gesture-matrix.ts'

test.describe.configure({ timeout: 900_000 })

test('every canvas gesture against every container, in the square format', async ({ browser }) => {
  const { rows, unexpected, table } = await runMatrix(browser, 'sq')
  writeOutput('gesture-matrix-sq.md', `${table}\n`)
  console.log(`gesture matrix (sq): ${rows.length} cases, ${rows.filter((r) => r.result === 'pass').length} pass, ${unexpected.length} unexpected`)
  expect(unexpected).toEqual([])
})
