import { createRequire } from 'node:module'
import type { CanvasKit } from 'canvaskit-wasm'

// The full build, in every runtime: the default one can't encode JPEG or WebP, and one build keeps export parity.
// It is CommonJS whose types claim an ES default export, so require gives the init function itself.
const CanvasKitInit = createRequire(import.meta.url)('canvaskit-wasm/full') as typeof import('canvaskit-wasm').default

let canvasKit: Promise<CanvasKit> | undefined

/** CanvasKit in Node, loaded once; its wasm comes from the pinned canvaskit-wasm package. */
export function loadCanvasKit(): Promise<CanvasKit> {
  return (canvasKit ??= CanvasKitInit())
}
