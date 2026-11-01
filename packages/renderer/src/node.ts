import { createRequire } from 'node:module'
import type { CanvasKit } from '@razzlr/canvaskit'

// Our CanvasKit build (packages/canvaskit), the one every runtime loads, so exports match everywhere (ADR-0005).
// It is CommonJS whose types claim an ES default export, so require gives the init function itself.
const CanvasKitInit = createRequire(import.meta.url)('@razzlr/canvaskit') as typeof import('@razzlr/canvaskit').default

let canvasKit: Promise<CanvasKit> | undefined

/** CanvasKit in Node, loaded once; its wasm comes from our pinned build. */
export function loadCanvasKit(): Promise<CanvasKit> {
  return (canvasKit ??= CanvasKitInit())
}
