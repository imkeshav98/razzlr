// The export worker (#55): draws exports on the CPU surface off the main thread, so the editor
// stays responsive while it makes every format. It has its own CanvasKit and keeps the fonts and
// images it was sent between exports, so each is decoded once.
import { exportDesign, type ExportedFile } from '@razzlr/export'
import { resourceCache, type ResourceBytes } from '@razzlr/renderer'
import canvasKitModule from 'canvaskit-wasm/full'
import type { ExportReply, ExportJob } from './export-client.ts'

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('canvaskit-wasm').default

/** What this file uses of a dedicated worker's global scope, which the DOM types don't describe. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ExportJob>) => void) | null
  postMessage(message: ExportReply, transfer?: Transferable[]): void
}

const loaded = CanvasKitInit({ locateFile: (file: string) => `/vendor/${file}` }).then((ck) => ({ ck, cache: resourceCache(ck) }))
const bytes: ResourceBytes = { fonts: [], fallbackFamilies: [], images: {} }

scope.onmessage = async ({ data: job }) => {
  try {
    const { ck, cache } = await loaded
    if (job.fonts) bytes.fonts = job.fonts
    if (job.fallbackFamilies) bytes.fallbackFamilies = job.fallbackFamilies
    Object.assign(bytes.images, job.images)
    const file: ExportedFile = exportDesign(ck, JSON.parse(job.design), job.request, { ...bytes, ...(job.variables ? { variables: job.variables } : {}) }, cache, (done, total) => scope.postMessage({ id: job.id, kind: 'progress', done, total }))
    scope.postMessage({ id: job.id, kind: 'done', file }, [file.bytes.buffer])
  } catch (error) {
    scope.postMessage({ id: job.id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
