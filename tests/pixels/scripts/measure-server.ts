// Measures server renders (#10): the export render of every fixture page and format, and all 100
// renders of the 20-card × 5-format carousel, with the process's peak memory.
// `taskset -c 0 node scripts/measure-server.ts` stands in for the one-core phase 0 server.
// Renders keep fonts and images in one resource cache, as a long-lived worker would (#30);
// `--no-cache` decodes them again for every render, as phase 0 measured.
import { renderDesign, resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { parseDesign } from '@dazbee/schema'
import { bigCarousel } from '../src/big-carousel.ts'
import { loadFixtures } from '../src/fixtures.ts'
import { fixtureResources } from '../src/pixels.ts'

const mb = (kb: number) => `${(kb / 1024).toFixed(0)} MB`
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

let start = performance.now()
const ck = await loadCanvasKit()
const bytes = fixtureResources()
const cache = process.argv.includes('--no-cache') ? undefined : resourceCache(ck)
console.log(`${cache ? 'with' : 'without'} a resource cache; start: CanvasKit and fonts loaded in ${(performance.now() - start).toFixed(0)} ms, peak memory ${mb(process.resourceUsage().maxRSS)}`)

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
        renderDesign(ck, json, pageId, formatId, bytes, cache)
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

// Leaks: 1,000 renders of a design whose text and images change, with memory read along the way.
const carousel = bigCarousel(3) as { nodes: Record<string, { props: Record<string, unknown> }> }
const rss = () => process.memoryUsage().rss / 1024
const memory: string[] = []
for (let i = 1; i <= 1000; i++) {
  const title = carousel.nodes['p1-title']
  if (title) title.props.text = `Render ${i}`
  // A new array for one image each time: the cache decodes it again and frees the old one.
  const images = { ...bytes.images, 'card-1': new Uint8Array(bytes.images['card-1'] ?? []) }
  renderDesign(ck, carousel, 'p1', 'mpu', { ...bytes, images }, cache)
  if (i === 100 || i === 500 || i === 1000) memory.push(`${i}: ${mb(rss())}`)
}
console.log(`memory over 1,000 renders (300×250) with a changing title and image: ${memory.join(', ')}`)
cache?.delete()
