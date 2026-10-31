// The picture of a design the home's bento shows (#84): its first page in its primary format,
// drawn on a small CPU surface like an export (ADR-0005), on a thread of its own, with the fonts
// and images we store. Like an asset's thumbnail (ADR-0010) it is an image we make and store, once
// per version of the design: the key carries the design's updatedAt, so an edit makes a new one.
import { readDesignState, type Db } from '@razzlr/db'
import { migrateDoc, readDesign } from '@razzlr/doc'
import type { Design, DesignSummary } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import { Worker } from 'node:worker_threads'
import * as Y from 'yjs'
import type { DrawJob, DrawResult } from './draw-worker.ts'
import { brandResourcesFor } from './render.ts'

/** The longest side of a design's picture: the bento's big tile on a 2× screen. */
export const DESIGN_THUMBNAIL_SIZE = 640

export const designThumbnailKey = (workspaceId: string, design: DesignSummary) =>
  `workspaces/${workspaceId}/designs/${design.id}/thumbnail-${Date.parse(design.updatedAt)}.png`

/** The page and format a design's picture shows: its first page, in its primary format. */
export function coverOf(design: Design) {
  const [pageId] = Object.entries(design.pages).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1)).map(([id]) => id)
  const formatId = design.formats[design.meta.primaryFormatId] ? design.meta.primaryFormatId : Object.keys(design.formats)[0]
  const format = formatId ? design.formats[formatId] : undefined
  if (!pageId || !formatId || !format) return null
  return { pageId, formatId, width: format.width, height: format.height }
}

/** The design as its stored Yjs state holds it, or null when it has none. */
export async function storedDesign(db: Db, designId: string): Promise<Design | null> {
  const state = await readDesignState(db, designId)
  if (!state) return null
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  migrateDoc(doc)
  return readDesign(doc)
}

export interface DesignCover { key: string; width: number; height: number }

/** The primary format's size, read from the stored design without drawing: what a tile needs to take its shape. */
export async function designCover(db: Db, summary: DesignSummary): Promise<{ width: number; height: number } | null> {
  const design = await storedDesign(db, summary.id)
  const cover = design && coverOf(design)
  return cover ? { width: cover.width, height: cover.height } : null
}

// The drawing thread, started on the first picture and started again if it dies.
let worker: Worker | undefined
let nextJob = 0
const waiting = new Map<number, { resolve: (png: Uint8Array) => void; reject: (error: Error) => void }>()

function drawingThread(): Worker {
  if (worker) return worker
  const thread = new Worker(new URL('./draw-worker.ts', import.meta.url))
  // An idle thread doesn't keep the process (or a test run) alive.
  thread.unref()
  thread.on('message', (result: DrawResult) => {
    const job = waiting.get(result.id)
    waiting.delete(result.id)
    if ('png' in result) job?.resolve(result.png)
    else job?.reject(new Error(result.error))
  })
  const fail = (error: Error) => {
    if (worker === thread) worker = undefined
    for (const job of waiting.values()) job.reject(error)
    waiting.clear()
  }
  thread.on('error', fail)
  thread.on('exit', (code) => fail(new Error(`the design picture thread stopped (${code})`)))
  worker = thread
  return thread
}

function drawOnThread(job: Omit<DrawJob, 'id'>): Promise<Uint8Array> {
  const thread = drawingThread()
  const id = nextJob++
  return new Promise<Uint8Array>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    thread.ref()
    thread.postMessage({ ...job, id } satisfies DrawJob)
  }).finally(() => {
    if (waiting.size === 0) thread.unref()
  })
}

// A picture being made, by its key, so two requests for the same one draw it once.
const making = new Map<string, Promise<void>>()

/**
 * The stored picture of the design as it is now, made first if this version has none, and the
 * primary format's size. It is drawn on its own thread (see draw-worker.ts), straight at its small
 * size. Null when the design has nothing to show.
 */
export async function ensureDesignThumbnail(db: Db, storage: Storage, workspaceId: string, summary: DesignSummary): Promise<DesignCover | null> {
  const design = await storedDesign(db, summary.id)
  const cover = design && coverOf(design)
  if (!design || !cover) return null
  const key = designThumbnailKey(workspaceId, summary)
  const shape = { key, width: cover.width, height: cover.height }
  if (await storage.exists(key)) return shape
  let made = making.get(key)
  if (!made) {
    made = (async () => {
      const resources = await brandResourcesFor(db, storage, workspaceId, summary.brandId, design)
      const scale = Math.min(1, DESIGN_THUMBNAIL_SIZE / Math.max(cover.width, cover.height))
      const size = { width: Math.max(1, Math.round(cover.width * scale)), height: Math.max(1, Math.round(cover.height * scale)) }
      const png = await drawOnThread({ design, pageId: cover.pageId, formatId: cover.formatId, format: { width: cover.width, height: cover.height }, size, resources })
      await storage.put(key, png, 'image/png')
    })().finally(() => making.delete(key))
    making.set(key, made)
  }
  await made
  return shape
}
