// An image asset's original bytes, for the editor (#35). The API checks org and client and hands
// back a short-lived signed URL; the bytes pass through here, so the browser needs no storage
// address or credentials.
import { assetLink } from '../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string; assetId: string }> }) {
  const { clientId, assetId } = await params
  const link = await assetLink(clientId, assetId)
  if (!link) return new Response('No such asset', { status: 404 })
  const stored = await fetch(link.url, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, {
    headers: {
      'content-type': link.asset.contentType,
      // An asset's bytes never change, but whether this viewer may see them can.
      'cache-control': 'private, max-age=3600',
    },
  })
}
