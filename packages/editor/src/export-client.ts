// The main thread's side of the export worker (#55). It sends the design as the tab holds it, and
// fonts and images only the first time the worker needs them.
import type { ExportedFile } from '@razzlr/export'
import type { ResourceBytes } from '@razzlr/renderer'
import type { Design, ExportRequestInput, Variables } from '@razzlr/schema'

export interface ExportJob {
  id: number
  /** The design as JSON: the editor's live view of it is not something a worker can be sent. */
  design: string
  request: ExportRequestInput
  fonts?: ResourceBytes['fonts']
  fallbackFamilies?: string[]
  images: Record<string, Uint8Array>
  /** The brand kit's values bound layers take (#53), sent with every job: they are small. */
  variables?: Variables
}
export type ExportReply =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'done'; file: ExportedFile }
  | { id: number; kind: 'error'; message: string }

export function exportClient() {
  let worker: Worker | undefined
  let next = 0
  let fontsSent: ResourceBytes['fonts'] | undefined
  const imagesSent = new Map<string, Uint8Array>()
  const waiting = new Map<number, { progress?: (done: number, total: number) => void; resolve: (file: ExportedFile) => void; reject: (error: Error) => void }>()

  function start() {
    const made = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' })
    made.onmessage = ({ data }: MessageEvent<ExportReply>) => {
      const job = waiting.get(data.id)
      if (!job) return
      if (data.kind === 'progress') return job.progress?.(data.done, data.total)
      waiting.delete(data.id)
      if (data.kind === 'done') job.resolve(data.file)
      else job.reject(new Error(data.message))
    }
    made.onerror = (event) => {
      for (const job of waiting.values()) job.reject(new Error(event.message || 'the export worker failed'))
      waiting.clear()
      // A fresh worker has nothing, so the next export sends everything again.
      made.terminate()
      worker = undefined
      fontsSent = undefined
      imagesSent.clear()
    }
    return made
  }

  return {
    /** Exports the request from `design` in the worker; `progress` hears each file as it is made. */
    run(design: Design, request: ExportJob['request'], bytes: ResourceBytes, progress?: (done: number, total: number) => void) {
      worker ??= start()
      const id = next++
      const fresh = fontsSent !== bytes.fonts
      const images = Object.fromEntries(Object.entries(bytes.images).filter(([assetId, data]) => imagesSent.get(assetId) !== data))
      const job: ExportJob = { id, design: JSON.stringify(design), request, images, ...(bytes.variables ? { variables: bytes.variables } : {}), ...(fresh ? { fonts: bytes.fonts, fallbackFamilies: bytes.fallbackFamilies } : {}) }
      const result = new Promise<ExportedFile>((resolve, reject) => waiting.set(id, { resolve, reject, ...(progress ? { progress } : {}) }))
      worker.postMessage(job)
      fontsSent = bytes.fonts
      for (const [assetId, data] of Object.entries(images)) imagesSent.set(assetId, data)
      return result
    },
    destroy() {
      worker?.terminate()
      worker = undefined
      for (const job of waiting.values()) job.reject(new Error('the editor closed'))
      waiting.clear()
    },
  }
}
