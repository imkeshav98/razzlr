// Copies the files the editor loads at runtime into public/vendor: CanvasKit's wasm and our fonts.
// They are bytes we control (CLAUDE.md), served from our own origin.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { FONT_FACES } from '@razzlr/fonts'
import { FONT_FILES_DIR } from '@razzlr/fonts/node'

const out = join(import.meta.dirname, '..', 'public', 'vendor')
mkdirSync(join(out, 'fonts'), { recursive: true })
copyFileSync(join(dirname(createRequire(import.meta.url).resolve('@razzlr/canvaskit')), 'canvaskit.wasm'), join(out, 'canvaskit.wasm'))
for (const face of FONT_FACES) copyFileSync(join(FONT_FILES_DIR, face.file), join(out, 'fonts', face.file))
