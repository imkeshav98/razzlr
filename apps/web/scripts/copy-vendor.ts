// Copies the files the editor loads at runtime into public/vendor: CanvasKit's wasm and our fonts.
// They are bytes we control (CLAUDE.md), served from our own origin.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import { FONT_FACES } from '@dazbee/fonts'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'

const out = join(import.meta.dirname, '..', 'public', 'vendor')
mkdirSync(join(out, 'fonts'), { recursive: true })
// Under its hashed name only, so an older build's wasm never lingers to be served.
for (const file of readdirSync(out)) if (file.startsWith('canvaskit')) rmSync(join(out, file))
copyFileSync(join(dirname(createRequire(import.meta.url).resolve('@dazbee/canvaskit')), 'canvaskit.wasm'), join(out, WASM_FILE))
for (const face of FONT_FACES) copyFileSync(join(FONT_FILES_DIR, face.file), join(out, 'fonts', face.file))
