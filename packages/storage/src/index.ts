// Object storage over the S3 API: RustFS in Docker Compose locally and in CI, Cloudflare R2 when
// deployed. Settings come from the environment only. Browsers never get credentials: uploads go
// straight to storage through short-lived signed URLs, and reads come back through the API.
import { AwsClient } from 'aws4fetch'

export interface StorageSettings {
  /** The S3 endpoint, such as http://127.0.0.1:59000 or https://<account>.r2.cloudflarestorage.com. */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** "auto" for R2. */
  region: string
  /** Where browsers reach storage, for signed URLs; the endpoint itself when left out. */
  publicEndpoint?: string
}

/**
 * Settings from STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY,
 * STORAGE_REGION and STORAGE_PUBLIC_ENDPOINT.
 */
export function storageSettings(env: NodeJS.ProcessEnv = process.env): StorageSettings {
  const read = (name: string) => {
    const value = env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  return {
    endpoint: read('STORAGE_ENDPOINT').replace(/\/+$/, ''),
    bucket: read('STORAGE_BUCKET'),
    accessKeyId: read('STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: read('STORAGE_SECRET_ACCESS_KEY'),
    region: env.STORAGE_REGION ?? 'auto',
    ...(env.STORAGE_PUBLIC_ENDPOINT ? { publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT.replace(/\/+$/, '') } : {}),
  }
}

export class StorageError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type Storage = ReturnType<typeof openStorage>

export function openStorage(settings: StorageSettings) {
  const client = new AwsClient({ accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, service: 's3', region: settings.region })
  const path = (key: string) => `${settings.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const objectUrl = (key: string) => `${settings.endpoint}/${path(key)}`
  const publicUrl = (key: string) => `${settings.publicEndpoint ?? settings.endpoint}/${path(key)}`

  async function send(url: string, init: RequestInit = {}) {
    const response = await client.fetch(url, init)
    if (!response.ok && response.status !== 404) {
      throw new StorageError(response.status, `storage answered ${response.status} to ${init.method ?? 'GET'}: ${(await response.text()).slice(0, 200)}`)
    }
    return response
  }

  /** A URL that lets its holder do one method on one key until it expires; nothing else. */
  async function sign(method: 'GET' | 'PUT', key: string, expiresInSeconds: number, headers: Record<string, string> = {}) {
    const url = new URL(publicUrl(key))
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds))
    // allHeaders: sign content-type and content-length too, which aws4fetch leaves out by default.
    const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: true } })
    return signed.url
  }

  return {
    /** Creates the bucket when it is missing; for local and CI storage, where we own the server. */
    async ensureBucket() {
      const url = `${settings.endpoint}/${settings.bucket}`
      if ((await send(url, { method: 'HEAD' })).ok) return
      await send(url, { method: 'PUT' })
    },
    async put(key: string, bytes: Uint8Array, contentType: string) {
      await send(objectUrl(key), { method: 'PUT', body: bytes, headers: { 'content-type': contentType } })
    },
    /** The object's bytes, or null when there is none. */
    async get(key: string): Promise<Uint8Array | null> {
      const response = await send(objectUrl(key))
      return response.status === 404 ? null : new Uint8Array(await response.arrayBuffer())
    },
    async delete(key: string) {
      await send(objectUrl(key), { method: 'DELETE' })
    },
    async exists(key: string): Promise<boolean> {
      return (await send(objectUrl(key), { method: 'HEAD' })).ok
    },
    /** A URL to upload one object of exactly this content type and size. */
    signedPut: (key: string, contentType: string, byteSize: number, expiresInSeconds: number) =>
      sign('PUT', key, expiresInSeconds, { 'content-type': contentType, 'content-length': String(byteSize) }),
    signedGet: (key: string, expiresInSeconds: number) => sign('GET', key, expiresInSeconds),
    /** The unsigned public address of an object, which storage must refuse. */
    publicUrl,
  }
}
