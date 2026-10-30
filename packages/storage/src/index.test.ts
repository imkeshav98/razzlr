// Against RustFS from Docker Compose (`docker compose up -d --wait storage`).
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { openStorage, storageSettings } from './index.ts'

const storage = openStorage(storageSettings({
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_BUCKET: 'razzlr-test',
  STORAGE_ACCESS_KEY_ID: 'razzlr',
  STORAGE_SECRET_ACCESS_KEY: 'razzlr-local-secret',
  STORAGE_REGION: 'us-east-1',
  ...process.env,
}))
const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

beforeAll(() => storage.ensureBucket())

describe('storage', () => {
  it('puts and gets bytes, and knows what it has', async () => {
    const key = `test/${randomUUID()}`
    expect(await storage.get(key)).toBeNull()
    expect(await storage.exists(key)).toBe(false)
    await storage.put(key, bytes, 'image/png')
    expect(await storage.exists(key)).toBe(true)
    expect(await storage.get(key)).toEqual(bytes)
  })

  it('takes an upload through a signed URL, and serves it through another', async () => {
    const key = `test/${randomUUID()}`
    const put = await fetch(await storage.signedPut(key, 'image/png', bytes.length, 60), { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' } })
    expect(put.status).toBe(200)
    const got = await fetch(await storage.signedGet(key, 60))
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
  })

  it('refuses an unsigned request and an expired URL', async () => {
    const key = `test/${randomUUID()}`
    await storage.put(key, bytes, 'image/png')
    expect((await fetch(storage.publicUrl(key))).status).toBe(403)
    expect((await fetch(storage.publicUrl(key), { method: 'PUT', body: bytes })).status).toBe(403)
    const url = await storage.signedGet(key, 1)
    await new Promise((resolve) => setTimeout(resolve, 2_100))
    expect((await fetch(url)).status).toBe(403)
  })

  it('refuses a signed upload of another type or size', async () => {
    const url = await storage.signedPut(`test/${randomUUID()}`, 'image/png', bytes.length, 60)
    expect((await fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } })).status).toBe(403)
    expect((await fetch(url, { method: 'PUT', body: new Uint8Array([...bytes, 0]), headers: { 'content-type': 'image/png' } })).status).toBe(403)
  })

  it('refuses a signed upload to another key', async () => {
    const url = new URL(await storage.signedPut(`test/${randomUUID()}`, 'image/png', bytes.length, 60))
    url.pathname = url.pathname.replace(/[^/]+$/, 'elsewhere')
    expect((await fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' } })).status).toBe(403)
  })
})
