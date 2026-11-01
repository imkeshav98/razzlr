// The build's recipe hash: every file in build/, so a change to the Skia commit, the build script or
// the bindings names a new build. Line endings are ignored, so a Windows checkout hashes the same.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const buildDir = join(import.meta.dirname, 'build')

/** The first 16 hex digits of the SHA-256 over build/'s file names and contents. */
export function recipeHash() {
  const hash = createHash('sha256')
  for (const name of readdirSync(buildDir).sort()) {
    hash.update(`${name}\n`)
    hash.update(readFileSync(join(buildDir, name), 'utf8').replaceAll('\r\n', '\n'))
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(recipeHash())
