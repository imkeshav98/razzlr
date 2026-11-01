// Times the Node CPU render of one fixture page: `node scripts/time-render.ts [fixture] [page] [format] [runs]`.
// Prints each run and the median; the first run includes warming up CanvasKit's code paths.
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { loadFixtures } from '../src/fixtures.ts'
import { fixtureResources } from '../src/pixels.ts'

const [name = 'stress', page = 'p1', format = 'sq', runs = '5'] = process.argv.slice(2)
const fixture = loadFixtures().find((f) => f.name === name)
if (!fixture) throw new Error(`no fixture "${name}"`)
const ck = await loadCanvasKit()
const bytes = fixtureResources()
const times: number[] = []
for (let i = 0; i < Number(runs); i++) {
  const start = performance.now()
  renderDesign(ck, fixture.json, page, format, bytes)
  times.push(performance.now() - start)
  console.log(`run ${i + 1}: ${times[i]?.toFixed(0)} ms`)
}
const sorted = [...times].sort((a, b) => a - b)
console.log(`${name} ${page}.${format}: median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(0)} ms over ${runs} runs`)
