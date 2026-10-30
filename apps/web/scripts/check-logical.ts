// Fails on physical left/right in CSS and Tailwind classes, so the UI mirrors for right-to-left
// languages (#51). Use start/end: margin-inline-start, ps-*, ms-*, start-*, text-start, border-s.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const CSS = /(?:^|[\s;{])(margin|padding|border)-(left|right)\b|(?:^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)|float\s*:\s*(left|right)/
// Tailwind utilities with a physical side, as a whole class (variants like hover: allowed).
const TW = /(?:^|[\s"'`:])-?(m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr]|text-left|text-right|float-left|float-right|scroll-[mp][lr]|inset-[lr])(?:-[\w./[\]]+)?(?=[\s"'`]|$)/

export function physicalSides(file: string, text: string): string[] {
  const css = file.endsWith('.css')
  return text.split('\n').flatMap((line, i) => {
    const hit = css ? CSS.test(line) : TW.test(line) && /className|cva|cn\(|buttonStyles/.test(line)
    return hit ? [`${file}:${i + 1}: ${line.trim()}`] : []
  })
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === '.next' || name === 'public') return []
    return statSync(path).isDirectory() ? walk(path) : /\.(css|tsx)$/.test(name) ? [path] : []
  })
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const problems = ['app', 'components'].flatMap((d) => walk(join(root, d))).flatMap((path) => physicalSides(relative(root, path), readFileSync(path, 'utf8')))
  if (problems.length > 0) {
    console.error(`Physical left/right found; use logical start/end instead:\n${problems.join('\n')}`)
    process.exit(1)
  }
}
