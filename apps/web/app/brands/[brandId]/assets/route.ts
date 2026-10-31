// The brand's asset library (#52): its images, found by name and tag, and image uploads. An upload
// passes through here to the API and storage, so the browser needs no storage address or credentials.
import { MAX_UPLOAD_BYTES, type ImageType } from '@razzlr/schema'
import { ApiFailure, listAssets, uploadAsset } from '../../../../lib/api.ts'

export async function GET(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  try {
    return Response.json(await listAssets(brandId, new URL(request.url).searchParams.get('q') ?? ''), { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}

/** An image's type by its first bytes: the PNG, JPEG and WebP the editor decodes. */
function imageType(bytes: Uint8Array): ImageType | null {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  return null
}

/** What an upload is called at first: its file name without the extension. */
function assetName(fileName: string) {
  const name = fileName.replace(/\.[^.]+$/, '').trim() || fileName.trim()
  return (name || 'Image').slice(0, 120)
}

export async function POST(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Send the image as the form field "file"' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'The image is larger than 30 MB' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = imageType(bytes)
  if (!type) return Response.json({ error: 'The file is not a PNG, JPEG or WebP image' }, { status: 400 })
  try {
    return Response.json(await uploadAsset(brandId, bytes, type, assetName(file.name)), { status: 201 })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
