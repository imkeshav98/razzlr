// The picture of a design the home's bento shows (#84): its first page in its primary format,
// drawn on the CPU surface like an export (ADR-0005) with the fonts and images we store, then
// scaled down. Like an asset's thumbnail (ADR-0010) it is an image we make and store, once per
// version of the design: the key carries the design's updatedAt, so an edit makes a new one.
import { readDesignState, type Db } from '@razzlr/db'
import { migrateDoc, readDesign } from '@razzlr/doc'
import { FALLBACK_FAMILIES } from '@razzlr/fonts'
import { loadFontFiles } from '@razzlr/fonts/node'
import { renderDesign } from '@razzlr/renderer'
import { loadCanvasKit } from '@razzlr/renderer/node'
import { brandVariables, fontFamilies, imageAssetIds, type Design, type DesignSummary } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import * as Y from 'yjs'
import { findAsset, originalKey } from './assets.ts'
import { getBrandKit } from './brand-kits.ts'
import { fontFiles } from './fonts.ts'
import { makeThumbnail } from './thumbnails.ts'

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

/**
 * The stored picture of the design as it is now, made first if this version has none, and the
 * primary format's size, so a tile can take its shape before the picture loads. Null when the
 * design has no state or nothing to show.
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
  const shipped = loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes }))
  const stored = await fontFiles(db, storage, workspaceId, summary.brandId, fontFamilies(design, variables))
  const ck = await loadCanvasKit()
  const { png } = renderDesign(ck, design, cover.pageId, cover.formatId, { fonts: [...shipped, ...stored], fallbackFamilies: [...FALLBACK_FAMILIES], images, variables })
  const thumbnail = await makeThumbnail(png, 'image/png', DESIGN_THUMBNAIL_SIZE)
  await storage.put(key, thumbnail.bytes, thumbnail.contentType)
  return shape
}
