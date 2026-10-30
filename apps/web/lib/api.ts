// The API, called from the web app's server only, with every response read through its contract.
import 'server-only'
import { ApiError, ClientSummary, DesignSummary, SyncToken } from '@razzlr/schema'
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

export const listClients = () => call(ClientSummary.array(), '/clients')

export const listDesigns = (clientId: string) => call(DesignSummary.array(), `/clients/${encodeURIComponent(clientId)}/designs`)

export const createDesign = (clientId: string, name: string) =>
  call(DesignSummary, `/clients/${encodeURIComponent(clientId)}/designs`, { method: 'POST', body: { name } })

/** The client and design, or null when the API has no such design for this session. */
export async function findDesign(clientId: string, designId: string) {
  try {
    const [design, clients] = await Promise.all([
      call(DesignSummary, `/clients/${encodeURIComponent(clientId)}/designs/${encodeURIComponent(designId)}`),
      listClients(),
    ])
    const client = clients.find((c) => c.id === clientId)
    return client ? { client, design } : null
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
}

export const syncToken = (clientId: string, designId: string) =>
  call(SyncToken, `/clients/${encodeURIComponent(clientId)}/designs/${encodeURIComponent(designId)}/sync-token`, { method: 'POST', body: {} })
