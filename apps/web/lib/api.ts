// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ApiError, AssetLink, AssetSummary, BrandKit, BrandSummary, DesignCover, DesignSummary, DesignThumbnail, FontFace, FontFamily, FontLink, FontUploadTicket, SignedIn, SignedLink, SignedOut, SignInLink, SyncToken, TemplateSummary, UploadTicket, WorkspaceSummary, type FontType, type ImageType, type SaveTemplate, type UpdateAsset, type UpdateWorkspace } from '@razzlr/schema'
import type { z } from 'zod'

const API_URL = process.env.API_URL ?? 'http://localhost:8787'

export class ApiFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The httpOnly cookie that keeps the API's session token (#58). */
export const SESSION_COOKIE = 'razzlr_session'

/**
 * Calls the API as the signed-in person. Without a session the API answers 401, and the person is
 * sent to sign in; routes that must answer instead pass `signIn: false`.
 */
async function call<T extends z.ZodType>(schema: T, path: string, init?: { method: string; body?: unknown }, { signIn = true } = {}): Promise<z.infer<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers,
    ...(init ? { method: init.method, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) } : {}),
  })
  if (response.status === 401 && signIn) redirect('/login')
  const json: unknown = await response.json()
  if (!response.ok) throw new ApiFailure(response.status, ApiError.safeParse(json).data?.error ?? `The API answered ${response.status}`)
  return schema.parse(json)
}

/** WorkOS's sign-in page for this state, or null when sign-in is not set up (#58). */
export async function signInLink(state: string) {
  try {
    return (await call(SignInLink, `/auth/sign-in-url?state=${encodeURIComponent(state)}`, undefined, { signIn: false })).url
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** Swaps the code WorkOS sent back for a session (#58). */
export const completeSignIn = (code: string) => call(SignedIn, '/auth/callback', { method: 'POST', body: { code } }, { signIn: false })

/** Where to end the person's WorkOS session as they sign out, if anywhere (#58). */
export const signOutLink = async () => (await call(SignedOut, '/auth/sign-out', { method: 'POST' }, { signIn: false })).logoutUrl

export const getWorkspace = () => call(WorkspaceSummary, '/workspace')

/** Saves who the workspace is for (#109), which changes only words and defaults (ADR-0011), or its name. */
export const updateWorkspace = (patch: UpdateWorkspace) => call(WorkspaceSummary, '/workspace', { method: 'PATCH', body: patch })

export const listBrands = () => call(BrandSummary.array(), '/brands')

export const createBrand = (name: string) => call(BrandSummary, '/brands', { method: 'POST', body: { name } })

export const listDesigns = (brandId: string) => call(DesignSummary.array(), `/brands/${encodeURIComponent(brandId)}/designs`)

export const createDesign = (brandId: string, name: string, content?: unknown) =>
  call(DesignSummary, `/brands/${encodeURIComponent(brandId)}/designs`, { method: 'POST', body: content === undefined ? { name } : { name, content } })

/** The size of a design's primary format (#84), read without drawing, or null when it has nothing to show. */
export async function designCover(brandId: string, designId: string) {
  try {
    return await call(DesignCover, `/brands/${encodeURIComponent(brandId)}/designs/${encodeURIComponent(designId)}/cover`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

/** A design's picture for the home (#84), or null when it has nothing to show yet. */
export async function designThumbnail(brandId: string, designId: string) {
  try {
    return await call(DesignThumbnail, `/brands/${encodeURIComponent(brandId)}/designs/${encodeURIComponent(designId)}/thumbnail`)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

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
