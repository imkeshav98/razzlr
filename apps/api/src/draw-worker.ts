// Draws design pictures (#84) on a thread of its own, so a picture never holds up the API's other
// requests: drawing on the CPU surface (ADR-0005) is synchronous, and a design with large photos
// or hundreds of layers takes long enough to stall every request queued behind it. The thread
// keeps CanvasKit, the fonts we ship and its resource cache for its whole life.
import { parentPort } from 'node:worker_threads'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { drawDesign, resourceCache, type ResourceBytes, type ResourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Design } from '@dazbee/schema'

/** One picture to draw: the page in the format, scaled to the picture's size. */
export interface DrawJob {
  id: number
  design: Design
  pageId: string
  formatId: string
  /** The format's size, and the picture's. */
  format: { width: number; height: number }
  size: { width: number; height: number }
  /** What the design needs beyond the fonts we ship. */
  resources: ResourceBytes
}
export type DrawResult = { id: number; png: Uint8Array } | { id: number; error: string }

const shipped = loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))
let cache: ResourceCache | undefined

async function draw(job: DrawJob): Promise<Uint8Array> {
  const ck = await loadCanvasKit()
  cache ??= resourceCache(ck)
  const surface = ck.MakeSurface(job.size.width, job.size.height)
  if (!surface) throw new Error(`CanvasKit could not make a ${job.size.width}×${job.size.height} surface for a design picture`)
  try {
    // Drawn straight at the small size: a story is a 360×640 draw, not a 1080×1920 one.
    surface.getCanvas().scale(job.size.width / job.format.width, job.size.height / job.format.height)
    const resources = { ...job.resources, fonts: [...shipped, ...job.resources.fonts], fallbackFamilies: [...FALLBACK_FAMILIES] }
    drawDesign(ck, surface, job.design, job.pageId, job.formatId, resources, cache)
    const snapshot = surface.makeImageSnapshot()
    try {
      const png = snapshot.encodeToBytes()
      if (!png) throw new Error('CanvasKit could not encode a design picture')
      return png
    } finally {
      snapshot.delete()
    }
  } finally {
    surface.dispose()
  }
}

// One job at a time, in the order they came: each draw is synchronous anyway.
let queue = Promise.resolve()
parentPort?.on('message', (job: DrawJob) => {
  queue = queue.then(async () => {
    try {
      const png = await draw(job)
      parentPort?.postMessage({ id: job.id, png } satisfies DrawResult)
    } catch (error) {
      parentPort?.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) } satisfies DrawResult)
    }
  })
})
