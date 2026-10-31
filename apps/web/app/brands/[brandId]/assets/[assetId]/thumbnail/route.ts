// An asset's thumbnail for the asset library (#52): the small copy the API made and stored, passed
// through here like the original, so the browser needs no storage address or credentials.
import { thumbnailLink } from '../../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; assetId: string }> }) {
  const { brandId, assetId } = await params
  const link = await thumbnailLink(brandId, assetId)
  if (!link) return new Response('No such asset', { status: 404 })
  const stored = await fetch(link.url, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, {
    headers: {
      'content-type': stored.headers.get('content-type') ?? 'application/octet-stream',
      // A thumbnail never changes, but whether this viewer may see it can.
      'cache-control': 'private, max-age=3600',
    },
  })
}
