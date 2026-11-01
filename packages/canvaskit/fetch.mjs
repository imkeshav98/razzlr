// Puts our CanvasKit build into bin/: the files of the GitHub release that release.json names, each
// checked against its SHA-256. Fails when build/ changed since that release, so a stale build is
// never used. Runs on every pnpm install; files already in place and matching are kept.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { recipeHash } from './recipe.mjs'

const here = import.meta.dirname
const release = JSON.parse(readFileSync(join(here, 'release.json'), 'utf8'))
const recipe = recipeHash()
if (release.recipe !== recipe) {
  console.error(
    `@dazbee/canvaskit: build/ hashes to ${recipe}, but release.json is the build of ${release.recipe}.\n` +
      'Run the CanvasKit workflow on this branch and commit the release.json it prints.',
  )
  process.exit(1)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bin = join(here, 'bin')
mkdirSync(bin, { recursive: true })

for (const [name, expected] of Object.entries(release.files)) {
  const file = join(bin, name)
  if (existsSync(file) && sha256(readFileSync(file)) === expected) continue
  const url = `https://github.com/${release.repo}/releases/download/${release.tag}/${name}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`@dazbee/canvaskit: ${url} answered ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== expected) throw new Error(`@dazbee/canvaskit: ${name} hashes to ${actual}, not ${expected}`)
  writeFileSync(`${file}.part`, bytes)
  renameSync(`${file}.part`, file)
  console.log(`@dazbee/canvaskit: fetched ${name} (${bytes.length} bytes) from ${release.tag}`)
}
