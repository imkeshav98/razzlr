// Uploaded images. Originals are stored once per workspace by content hash; every brand that uploads
// the same bytes gets its own asset, so a brand never sees another brand's assets.
import { createHash, randomUUID } from 'node:crypto'
import { assets, type Db } from '@razzlr/db'
import type { AssetSummary, ImageType, UploadTicket } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import { and, asc, eq } from 'drizzle-orm'
import { readImageHeader } from './images.ts'

/** How long a signed upload or read URL works. */
export const SIGNED_URL_SECONDS = 5 * 60

export const originalKey = (workspaceId: string, sha256: string) => `workspaces/${workspaceId}/originals/${sha256}`

const summary = {
  id: assets.id, brandId: assets.brandId, sha256: assets.sha256, contentType: assets.contentType,
  byteSize: assets.byteSize, width: assets.width, height: assets.height, createdAt: assets.createdAt,
}
const toSummary = (row: Omit<AssetSummary, 'createdAt'> & { createdAt: Date }): AssetSummary => ({ ...row, createdAt: row.createdAt.toISOString() })

export async function listAssets(db: Db, workspaceId: string, brandId: string): Promise<AssetSummary[]> {
  const rows = await db.select(summary).from(assets).where(and(eq(assets.workspaceId, workspaceId), eq(assets.brandId, brandId))).orderBy(asc(assets.createdAt), asc(assets.id))
  return rows.map(toSummary)
}

export async function findAsset(db: Db, workspaceId: string, brandId: string, by: { id: string } | { sha256: string }): Promise<AssetSummary | null> {
  const match = 'id' in by ? eq(assets.id, by.id) : eq(assets.sha256, by.sha256)
  const [row] = await db.select(summary).from(assets).where(and(match, eq(assets.workspaceId, workspaceId), eq(assets.brandId, brandId)))
  return row ? toSummary(row) : null
}

export class InvalidUpload extends Error {}

/**
 * Records the original stored under `sha256` as an asset of the brand, after checking the bytes
 * hash to it and are an image. Recording the same bytes again gives back the same asset.
 */
export async function recordAsset(db: Db, storage: Storage, workspaceId: string, brandId: string, sha256: string): Promise<AssetSummary> {
  const existing = await findAsset(db, workspaceId, brandId, { sha256 })
  if (existing) return existing
  const key = originalKey(workspaceId, sha256)
  const bytes = await storage.get(key)
  if (!bytes) throw new InvalidUpload('Nothing was uploaded for that SHA-256')
  // Bad bytes are deleted, so they never block a real upload of the same hash.
  const refuse = async (message: string) => {
    await storage.delete(key)
    return new InvalidUpload(message)
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw await refuse('The uploaded bytes do not match their SHA-256')
  const header = readImageHeader(bytes)
  if (!header) throw await refuse('The upload is not a PNG, JPEG or WebP image')
  await db.insert(assets).values({ id: randomUUID(), workspaceId, brandId, sha256, byteSize: bytes.length, ...header }).onConflictDoNothing()
  const recorded = await findAsset(db, workspaceId, brandId, { sha256 })
  if (!recorded) throw new Error('asset vanished after insert')
  return recorded
}

/** The asset when these bytes are already stored for the workspace; otherwise a signed URL to upload them. */
export async function startUpload(db: Db, storage: Storage, workspaceId: string, brandId: string, upload: { sha256: string; byteSize: number; contentType: ImageType }): Promise<UploadTicket> {
  const existing = await findAsset(db, workspaceId, brandId, { sha256: upload.sha256 })
  if (existing) return { asset: existing, upload: null }
  const key = originalKey(workspaceId, upload.sha256)
  if (await storage.exists(key)) {
    try {
      return { asset: await recordAsset(db, storage, workspaceId, brandId, upload.sha256), upload: null }
    } catch (e) {
      if (!(e instanceof InvalidUpload)) throw e
    }
  }
  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString()
  const url = await storage.signedPut(key, upload.contentType, upload.byteSize, SIGNED_URL_SECONDS)
  // Browsers set content-length from the body themselves; it is signed, so it must match byteSize.
  return { asset: null, upload: { url, headers: { 'content-type': upload.contentType }, expiresAt } }
}
