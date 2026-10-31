// A template's thumbnail for the gallery (#54), passed through like an asset's, so the browser
// needs no storage address or credentials.
import { templateThumbnailLink } from '../../../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string; templateId: string }> }) {
  const { brandId, templateId } = await params
  const link = await templateThumbnailLink(brandId, templateId)
  if (!link) return new Response('No such template', { status: 404 })
  const stored = await fetch(link.url, { cache: 'no-store' })
  if (!stored.ok) return new Response('Storage did not answer', { status: 502 })
  return new Response(stored.body, {
    headers: {
      'content-type': stored.headers.get('content-type') ?? 'image/png',
      // A template never changes, but whether this viewer may see it can.
      'cache-control': 'private, max-age=3600',
    },
  })
}
