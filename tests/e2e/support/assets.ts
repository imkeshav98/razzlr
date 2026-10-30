// Uploading images the way the browser does, for the checks that need an asset (#35, #48).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { AssetSummary, UploadTicket } from '@razzlr/schema'
import { API_URL, DEV_BRAND } from './seed.ts'

/** A stand-in photo from the pixel fixtures, 1920 × 1200. */
export const photo = new Uint8Array(readFileSync(join(import.meta.dirname, '..', '..', 'pixels', 'assets', 'sneaker.jpg')))

export async function api(path: string, body?: unknown) {
  const response = await fetch(`${API_URL}/brands/${DEV_BRAND}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json() as Promise<unknown>
}

/** Uploads the way the browser will: ask, PUT to the signed URL, record. */
export async function upload(bytes: Uint8Array<ArrayBuffer>) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ticket = UploadTicket.parse(await api('/assets/uploads', { sha256, byteSize: bytes.length, contentType: 'image/jpeg' }))
  if (ticket.asset) return ticket.asset
  const put = await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })
  expect(put.status).toBe(200)
  return AssetSummary.parse(await api('/assets', { sha256 }))
}
