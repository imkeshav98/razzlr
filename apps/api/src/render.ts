// Drawing a design in Node (#54): the same render seam the editor's exports use, with every byte it
// needs read from our storage as the editor reads it: the fonts we ship, the brand's catalog
// families, the originals of its images, and its brand kit's values.
import type { Db } from '@dazbee/db'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign, type Rendered, type ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { brandVariables, fontFamilies, imageAssetIds, type Design } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'
import { findAsset, originalKey } from './assets.ts'
import { getBrandKit } from './brand-kits.ts'
import { fontFiles } from './fonts.ts'

let shipped: { family: string; bytes: Uint8Array }[] | undefined

/**
 * What drawing the design for this brand needs beyond the fonts we ship: the brand's catalog
 * families, the originals of its images and its brand kit's values. An image the brand has no
 * asset for is left out. A drawing worker that holds the shipped fonts itself needs only this.
 */
export async function brandResourcesFor(db: Db, storage: Storage, workspaceId: string, brandId: string, design: Design): Promise<ResourceBytes> {
  const variables = brandVariables(await getBrandKit(db, workspaceId, brandId))
  const [fonts, images] = await Promise.all([
    fontFiles(db, storage, workspaceId, brandId, fontFamilies(design, variables)),
    Promise.all(imageAssetIds(design).map(async (id) => {
      const asset = await findAsset(db, workspaceId, brandId, { id })
      const bytes = asset && await storage.get(originalKey(workspaceId, asset.sha256))
      return bytes ? [[id, bytes] as const] : []
    })),
  ])
  return { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: Object.fromEntries(images.flat()), variables }
}

/** What drawing the design for this brand needs, the shipped fonts included. */
export async function resourcesFor(db: Db, storage: Storage, workspaceId: string, brandId: string, design: Design): Promise<ResourceBytes> {
  shipped ??= loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))
  const resources = await brandResourcesFor(db, storage, workspaceId, brandId, design)
  return { ...resources, fonts: [...shipped, ...resources.fonts] }
}

/** The first page in the primary format, as an export draws it. */
export async function renderFirstPage(db: Db, storage: Storage, workspaceId: string, brandId: string, design: Design): Promise<Rendered> {
  const ck = await loadCanvasKit()
  const [pageId] = Object.entries(design.pages).sort(([, a], [, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map(([id]) => id)
  if (!pageId) throw new Error('the design has no page')
  return renderDesign(ck, design, pageId, design.meta.primaryFormatId, await resourcesFor(db, storage, workspaceId, brandId, design))
}
