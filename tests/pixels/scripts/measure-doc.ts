// Measures the 20-card × 5-format carousel as a Yjs document (#10): its size on the wire and in
// Postgres, how long loading and reading it take, and what one command costs on it.
// `node scripts/measure-doc.ts`; pin it to one core with `taskset -c 0` to match the server.
import { gzipSync } from 'node:zlib'
import { loadDesign, openSession, readDesign } from '@razzlr/doc'
import { parseDesign } from '@razzlr/schema'
import * as Y from 'yjs'
import { bigCarousel } from '../src/big-carousel.ts'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const time = (run: () => void, times: number) => median(Array.from({ length: times }, () => {
  const start = performance.now()
  run()
  return performance.now() - start
}))
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

const parsed = parseDesign(bigCarousel())
if (!parsed.success) throw new Error(parsed.errors.join('\n'))
const design = parsed.design
const doc = loadDesign(design)
const size = () => {
  const update = Y.encodeStateAsUpdate(doc)
  return `${kb(update.length)} (${kb(gzipSync(update).length)} gzipped)`
}
const overrides = Object.values(design.overrides).reduce((n, byNode) => n + Object.values(byNode).reduce((m, props) => m + Object.keys(props).length, 0), 0)
console.log(`design: ${Object.keys(design.pages).length} pages, ${Object.keys(design.formats).length} formats, ${Object.keys(design.nodes).length} layers, ${overrides} override values`)
console.log(`design JSON: ${kb(JSON.stringify(design).length)}`)
console.log(`Yjs state, fresh: ${size()}`)
const update = Y.encodeStateAsUpdate(doc)
console.log(`load the state into a new doc: ${time(() => Y.applyUpdate(new Y.Doc(), update), 9).toFixed(1)} ms median`)
console.log(`readDesign (the whole design as validated JSON): ${time(() => readDesign(doc), 9).toFixed(1)} ms median`)

// One command reads the design to check its input, so its cost grows with the design.
const session = openSession(doc)
let x = 0
console.log(`one node.update command: ${time(() => session.run('node.update', { ids: ['p7-title'], patch: { x: x++ % 200 } }), 51).toFixed(1)} ms median`)

// A working session: 1,000 more edits of the kinds people make, then the size again.
for (let i = 0; i < 1000; i++) {
  const card = `p${(i % 20) + 1}`
  if (i % 3 === 0) session.run('text.edit', { id: `${card}-title`, op: { kind: 'insert', at: 0, text: 'N' } })
  else if (i % 3 === 1) session.run('text.edit', { id: `${card}-title`, op: { kind: 'delete', at: 0, length: 1 } })
  else session.run('node.update', { ids: [`${card}-cta`], scope: i % 2 ? 'base' : 'format:story', patch: { x: 700 + (i % 50) } })
}
console.log(`Yjs state after 1,000 more edits: ${size()}`)
session.destroy()
