// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'
import { ApiError, AssetLink, AssetSummary, BrandKit, BrandSummary, DesignSummary, FontFace, FontFamily, FontLink, FontUploadTicket, SignedLink, SyncToken, TemplateSummary, UploadTicket, WorkspaceSummary, type FontType, type ImageType, type SaveTemplate, type UpdateAsset } from '@razzlr/schema'
import type { z } from 'zod'

const API_URL = process.env.API_URL ?? 'http://localhost:8787'

export class ApiFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T extends z.ZodType>(schema: T, path: string, init?: { method: string; body: unknown }): Promise<z.infer<T>> {
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    ...(init ? { method: init.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
  })
  const json: unknown = await response.json()
  if (!response.ok) throw new ApiFailure(response.status, ApiError.safeParse(json).data?.error ?? `The API answered ${response.status}`)
  return schema.parse(json)
}

export const getWorkspace = () => call(WorkspaceSummary, '/workspace')

export const listBrands = () => call(BrandSummary.array(), '/brands')

export const listDesigns = (brandId: string) => call(DesignSummary.array(), `/brands/${encodeURIComponent(brandId)}/designs`)

export const createDesign = (brandId: string, name: string) =>
  call(DesignSummary, `/brands/${encodeURIComponent(brandId)}/designs`, { method: 'POST', body: { name } })

/** The brand and design, or null when the API has no such design for this session. */
export async function findDesign(brandId: string, designId: string) {
  try {
    const [design, brands] = await Promise.all([
      call(DesignSummary, `/brands/${encodeURIComponent(brandId)}/designs/${encodeURIComponent(designId)}`),
      listBrands(),
    ])
    const brand = brands.find((c) => c.id === brandId)
    return brand ? { brand, design } : null
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

export const syncToken = (brandId: string, designId: string) =>
  call(SyncToken, `/brands/${encodeURIComponent(brandId)}/designs/${encodeURIComponent(designId)}/sync-token`, { method: 'POST', body: {} })

/** An asset and a signed URL to its original, or null when the API has no such asset for this session. */
export async function assetLink(brandId: string, assetId: string) {
  try {
    return await call(AssetLink, `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** The fonts a brand picks from (#50): Google Fonts copied into our storage and the brand's uploads. */
export const listFonts = (brandId: string) => call(FontFamily.array(), `/brands/${encodeURIComponent(brandId)}/fonts`)

/** A face and signed URLs to its file and preview, or null when the API has no such face for this session. */
export async function fontLink(brandId: string, faceId: string) {
  try {
    return await call(FontLink, `/brands/${encodeURIComponent(brandId)}/fonts/faces/${encodeURIComponent(faceId)}`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Uploads a font file for the brand: asks, PUTs the bytes to storage when asked to, records it. */
export async function uploadFont(brandId: string, bytes: Uint8Array<ArrayBuffer>, contentType: FontType) {
  const brand = `/brands/${encodeURIComponent(brandId)}/fonts`
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
  const ticket = await call(FontUploadTicket, `${brand}/uploads`, { method: 'POST', body: { sha256, byteSize: bytes.length, contentType } })
  if (ticket.face) return ticket.face
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  if (!put.ok) throw new ApiFailure(502, `Storage answered ${put.status} to the upload`)
  return call(FontFace, brand, { method: 'POST', body: { sha256 } })
}

/** The brand's assets, newest first; with a query, those whose name or tags match every word of it (#52). */
export const listAssets = (brandId: string, query = '') =>
  call(AssetSummary.array(), `/brands/${encodeURIComponent(brandId)}/assets${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)

/** Renames an asset or sets its tags (#52). */
export const updateAsset = (brandId: string, assetId: string, update: UpdateAsset) =>
  call(AssetSummary, `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`, { method: 'PATCH', body: update })

/** A signed URL to the asset's thumbnail, or null when the API has no such asset for this session (#52). */
export async function thumbnailLink(brandId: string, assetId: string) {
  try {
    return await call(SignedLink, `/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}/thumbnail`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Uploads an image for the brand under a name: asks, PUTs the bytes to storage when asked to, records it (#52). */
export async function uploadAsset(brandId: string, bytes: Uint8Array<ArrayBuffer>, contentType: ImageType, name: string) {
  const brand = `/brands/${encodeURIComponent(brandId)}/assets`
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
  const ticket = await call(UploadTicket, `${brand}/uploads`, { method: 'POST', body: { sha256, byteSize: bytes.length, contentType, name } })
  if (ticket.asset) return ticket.asset
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  if (!put.ok) throw new ApiFailure(502, `Storage answered ${put.status} to the upload`)
  return call(AssetSummary, brand, { method: 'POST', body: { sha256, name } })
}

/** The brand's kit (#53): its colours and fonts designs bind to, its logo and its tone of voice. */
export const getBrandKit = (brandId: string) => call(BrandKit, `/brands/${encodeURIComponent(brandId)}/kit`)

/** Saves the brand's whole kit (#53). */
export const saveBrandKit = (brandId: string, kit: BrandKit) => call(BrandKit, `/brands/${encodeURIComponent(brandId)}/kit`, { method: 'PUT', body: kit })

/** The templates a brand can start from (#54): the workspace's and its own, newest first. */
export const listTemplates = (brandId: string) => call(TemplateSummary.array(), `/brands/${encodeURIComponent(brandId)}/templates`)

/** Saves a design as a template, for the whole workspace or the brand alone (#54). */
export const saveTemplate = (brandId: string, template: SaveTemplate) =>
  call(TemplateSummary, `/brands/${encodeURIComponent(brandId)}/templates`, { method: 'POST', body: template })

/** A signed URL to a template's thumbnail, or null when this brand can't see the template (#54). */
export async function templateThumbnailLink(brandId: string, templateId: string) {
  try {
    return await call(SignedLink, `/brands/${encodeURIComponent(brandId)}/templates/${encodeURIComponent(templateId)}/thumbnail`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Starts a design of the brand from a template: its own copy, with fresh ids (#54). */
export const startFromTemplate = (brandId: string, templateId: string, name?: string) =>
  call(DesignSummary, `/brands/${encodeURIComponent(brandId)}/templates/${encodeURIComponent(templateId)}/designs`, { method: 'POST', body: name ? { name } : {} })
