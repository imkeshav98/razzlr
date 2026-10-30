// Downloads the brand fonts pinned in fonts.json (google/fonts at one commit) and checks each
// file's SHA-256, so every run of the test draws with the same bytes.
// Run with NODE_USE_ENV_PROXY=1 behind a proxy.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import manifest from '../fonts.json' with { type: 'json' }
import { FONTS_DIR } from '../src/fonts.ts'

mkdirSync(FONTS_DIR, { recursive: true })
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

for (const face of manifest.faces) {
  const file = join(FONTS_DIR, basename(face.path))
  if (existsSync(file) && sha256(readFileSync(file)) === face.sha256) continue
  const url = `https://raw.githubusercontent.com/google/fonts/${manifest.commit}/${face.path}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== face.sha256) throw new Error(`${url} does not match its pinned SHA-256`)
  writeFileSync(file, bytes)
  console.log(`fetched ${face.family} ${face.weight}`)
}
console.log(`${manifest.faces.length} brand font faces ready in ${FONTS_DIR}`)
