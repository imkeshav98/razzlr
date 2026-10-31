// A font face's preview, its family's name drawn in it as a PNG, for the font picker (#50): the
// browser shows a picture and never decodes the font.
import { fontLink } from '../../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; faceId: string }> }) {
  const { brandId, faceId } = await params
  const link = await fontLink(brandId, faceId)
  if (!link) return new Response('No such font', { status: 404 })
  const stored = await fetch(link.previewUrl, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } })
}
