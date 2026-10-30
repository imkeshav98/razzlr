// The API's requests and responses. The API parses every body with these, and the web app reads
// every response with them, so the two can't drift apart.
import { z } from 'zod'
import { DesignMeta } from './design.ts'

/** Server-made ids of orgs, clients and designs. Design ids double as Yjs document names. */
export const RecordId = z.string().regex(/^[\w-]{1,64}$/, 'ids are 1–64 letters, digits, _ and -')

export const ClientSummary = z.object({
  id: RecordId,
  name: z.string(),
})
export type ClientSummary = z.infer<typeof ClientSummary>

export const CreateClient = z.object({
  name: z.string().trim().min(1).max(120),
})
export type CreateClient = z.infer<typeof CreateClient>

export const DesignSummary = z.object({
  id: RecordId,
  clientId: RecordId,
  name: z.string(),
  kind: DesignMeta.shape.kind,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type DesignSummary = z.infer<typeof DesignSummary>

export const CreateDesign = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * The design to start from, checked with parseDesign; its meta.designId and name are replaced
   * by the new design's. Left out, the design starts as one blank 1080×1080 page.
   */
  content: z.unknown().optional(),
})
export type CreateDesign = z.infer<typeof CreateDesign>

/** Every error the API sends: a short message a person can read. */
export const ApiError = z.object({
  error: z.string(),
})
export type ApiError = z.infer<typeof ApiError>

/** Lets the editor open one design on the sync server until it expires. */
export const SyncToken = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
})
export type SyncToken = z.infer<typeof SyncToken>

/** The image types we accept and decode with CanvasKit (ADR-0006: images are fills). */
export const ImageType = z.enum(['image/png', 'image/jpeg', 'image/webp'])
export type ImageType = z.infer<typeof ImageType>

/** Largest original we accept, in bytes. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 is 64 lowercase hex digits')

export const AssetSummary = z.object({
  id: RecordId,
  clientId: RecordId,
  sha256: Sha256,
  contentType: ImageType,
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.iso.datetime(),
})
export type AssetSummary = z.infer<typeof AssetSummary>

/** Asks to upload an original; the API answers with the asset when it already has those bytes. */
export const StartUpload = z.object({
  sha256: Sha256,
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: ImageType,
})
export type StartUpload = z.infer<typeof StartUpload>

export const UploadTicket = z.union([
  z.object({ asset: AssetSummary, upload: z.null() }),
  /** PUT the bytes to url with these headers, then record the asset with its sha256. */
  z.object({ asset: z.null(), upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()), expiresAt: z.iso.datetime() }) }),
])
export type UploadTicket = z.infer<typeof UploadTicket>

export const RecordAsset = z.object({ sha256: Sha256 })
export type RecordAsset = z.infer<typeof RecordAsset>

/** An asset and a short-lived URL to read its original. */
export const AssetLink = z.object({
  asset: AssetSummary,
  url: z.url(),
  expiresAt: z.iso.datetime(),
})
export type AssetLink = z.infer<typeof AssetLink>
