// The picture of a design the home's bento shows (#84): its first page in its primary format,
// drawn on a small CPU surface like an export (ADR-0005), with the fonts and images we store. Like an asset's thumbnail (ADR-0010) it is an image we make and store, once per
// version of the design: the key carries the design's updatedAt, so an edit makes a new one.
import { readDesignState, type Db } from '@razzlr/db'
import { migrateDoc, readDesign } from '@razzlr/doc'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { drawDesign, resourceCache, type ResourceCache } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { brandVariables, fontFamilies, imageAssetIds, type Design, type DesignSummary } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import * as Y from 'yjs'
import { findAsset, originalKey } from './assets.ts'
import { getBrandKit } from './brand-kits.ts'
import { fontFiles } from './fonts.ts'

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

// One CanvasKit cache and one copy of the shipped fonts for the life of the process, so each
// picture registers only the fonts its design adds.
let shipped: { family: string; bytes: Uint8Array }[] | null = null
let cache: ResourceCache | null = null

/**
 * The stored picture of the design as it is now, made first if this version has none, and the
 * primary format's size. It is drawn straight at its small size, scaled on the canvas, so a story
 * costs a 360×640 draw rather than a full 1080×1920 one. Null when the design has nothing to show.
 */
export async function ensureDesignThumbnail(db: Db, storage: Storage, workspaceId: string, summary: DesignSummary): Promise<DesignCover | null> {
  const design = await storedDesign(db, summary.id)
  const cover = design && coverOf(design)
  if (!design || !cover) return null
  const key = designThumbnailKey(workspaceId, summary)
  const shape = { key, width: cover.width, height: cover.height }
  if (await storage.exists(key)) return shape
  const variables = brandVariables(await getBrandKit(db, workspaceId, summary.brandId))
  const images = Object.fromEntries((await Promise.all(imageAssetIds(design).map(async (id) => {
    const asset = await findAsset(db, workspaceId, summary.brandId, { id })
    const bytes = asset && await storage.get(originalKey(workspaceId, asset.sha256))
    // A missing image draws as the editor draws one still loading, so the picture still comes.
    return bytes ? [[id, bytes] as const] : []
  }))).flat())
  shipped ??= loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes }))
  const stored = await fontFiles(db, storage, workspaceId, summary.brandId, fontFamilies(design, variables))
  const ck = await loadCanvasKit()
  cache ??= resourceCache(ck)
  const scale = Math.min(1, DESIGN_THUMBNAIL_SIZE / Math.max(cover.width, cover.height))
  const width = Math.max(1, Math.round(cover.width * scale))
  const height = Math.max(1, Math.round(cover.height * scale))
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error(`CanvasKit could not make a ${width}×${height} surface for a design picture`)
  try {
    surface.getCanvas().scale(width / cover.width, height / cover.height)
    drawDesign(ck, surface, design, cover.pageId, cover.formatId, { fonts: [...shipped, ...stored], fallbackFamilies: [...FALLBACK_FAMILIES], images, variables }, cache)
    const snapshot = surface.makeImageSnapshot()
    try {
      const png = snapshot.encodeToBytes()
      if (!png) throw new Error('CanvasKit could not encode a design picture')
      await storage.put(key, png, 'image/png')
    } finally {
      snapshot.delete()
    }
  } finally {
    surface.dispose()
  }
  return shape
}
