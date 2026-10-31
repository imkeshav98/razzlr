// An image asset's original bytes, for the editor (#35). The API checks workspace and brand and hands
// back a short-lived signed URL; the bytes pass through here, so the browser needs no storage
// address or credentials. PATCH renames it or sets its tags (#52).
import { UpdateAsset } from '@razzlr/schema'
import { ApiFailure, assetLink, updateAsset } from '../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; assetId: string }> }) {
  const { brandId, assetId } = await params
  const link = await assetLink(brandId, assetId)
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

export async function PATCH(request: Request, { params }: { params: Promise<{ brandId: string; assetId: string }> }) {
  const { brandId, assetId } = await params
  const update = UpdateAsset.safeParse(await request.json().catch(() => null))
  if (!update.success) return Response.json({ error: update.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  try {
    return Response.json(await updateAsset(brandId, assetId, update.data))
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
