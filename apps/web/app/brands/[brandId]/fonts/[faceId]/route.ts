// A font face's file, for the editor (#50). The API checks workspace and brand and hands back a
// short-lived signed URL; the bytes pass through here from our storage.
import { fontLink } from '../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; faceId: string }> }) {
  const { brandId, faceId } = await params
  const link = await fontLink(brandId, faceId)
  if (!link) return new Response('No such font', { status: 404 })
  const stored = await fetch(link.url, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, {
    headers: {
      'content-type': 'font/sfnt',
      // A face's file never changes (a new upload is a new face), but whether this viewer may see it can.
      'cache-control': 'private, max-age=86400',
    },
  })
}
