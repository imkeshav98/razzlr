// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'
import { ApiError, AssetLink, BrandSummary, DesignSummary, FontFace, FontFamily, FontLink, FontUploadTicket, SyncToken, WorkspaceSummary, type FontType } from '@razzlr/schema'
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
