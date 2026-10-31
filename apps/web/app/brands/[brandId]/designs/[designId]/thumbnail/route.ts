// A design's picture for the home's bento (#84). The API checks workspace and brand, draws the
// picture once per version and hands back a short-lived signed URL; the bytes pass through here,
// so the browser needs no storage address. The page asks with ?v=<updatedAt>, so each version is
// its own URL and can be kept.
import { designThumbnail } from '../../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; designId: string }> }) {
  const { brandId, designId } = await params
  const link = await designThumbnail(brandId, designId)
  if (!link) return new Response('No picture for this design', { status: 404 })
  const stored = await fetch(link.url, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } })
}
