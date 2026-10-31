// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'
import { ApiError, AssetLink, BrandSummary, DesignSummary, SyncToken, WorkspaceSummary } from '@razzlr/schema'
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
