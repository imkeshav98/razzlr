import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

/** The six spike test designs, by file name without `.json`. */
export function loadFixtures(): { name: string; json: unknown }[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.replace(/\.json$/, ''), json: JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) }))
}
