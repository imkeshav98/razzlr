// Measures server renders (#10): the export render of every fixture page and format, and all 100
// renders of the 20-card × 5-format carousel, with the process's peak memory.
// `taskset -c 0 node scripts/measure-server.ts` stands in for the one-core phase 0 server.
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { parseDesign } from '@razzlr/schema'
import { bigCarousel } from '../src/big-carousel.ts'
import { loadFixtures } from '../src/fixtures.ts'
import { fixtureResources } from '../src/pixels.ts'

const mb = (kb: number) => `${(kb / 1024).toFixed(0)} MB`
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

let start = performance.now()
const ck = await loadCanvasKit()
const bytes = fixtureResources()
console.log(`start: CanvasKit and fonts loaded in ${(performance.now() - start).toFixed(0)} ms, peak memory ${mb(process.resourceUsage().maxRSS)}`)

console.log('\n| Fixture page.format | Size | Render, median of 3 |\n|---|---|---|')
const fixtures = [...loadFixtures().filter((f) => f.name !== 'layer-bounds'), { name: 'big-carousel', json: bigCarousel() as unknown }]
for (const { name, json } of fixtures) {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const { pages, formats } = parsed.design
  const all: number[] = []
  for (const pageId of Object.keys(pages)) {
    for (const [formatId, format] of Object.entries(formats)) {
      const runs = [0, 1, 2].map(() => {
        start = performance.now()
        renderDesign(ck, json, pageId, formatId, bytes)
        return performance.now() - start
      })
      all.push(median(runs))
      if (name !== 'big-carousel') console.log(`| ${name} ${pageId}.${formatId} | ${format.width}×${format.height} | ${median(runs).toFixed(0)} ms |`)
    }
  }
  if (name === 'big-carousel') {
    const total = all.reduce((a, b) => a + b, 0)
    console.log(`| big-carousel, all ${all.length} renders | 5 formats | ${median(all).toFixed(0)} ms median, ${Math.max(...all).toFixed(0)} ms max, ${(total / 1000).toFixed(1)} s in all |`)
  }
}
console.log(`\npeak memory of the whole run: ${mb(process.resourceUsage().maxRSS)}`)
