// The brand's font catalog for the editor, and font uploads (#50). An upload passes through here to
// the API and storage, so the browser needs no storage address or credentials.
import { MAX_FONT_BYTES, type FontType } from '@razzlr/schema'
import { ApiFailure, listFonts, uploadFont } from '../../../../lib/api.ts'

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  try {
    return Response.json(await listFonts(brandId), { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return new Response('No such brand', { status: 404 })
    throw e
  }
}

/** A font file's type by its first four bytes: TrueType outlines or CFF ones. */
function fontType(bytes: Uint8Array): FontType | null {
  const head = String.fromCharCode(...bytes.subarray(0, 4))
  if (head === '\0\u0001\0\0' || head === 'true') return 'font/ttf'
  if (head === 'OTTO') return 'font/otf'
  return null
}

export async function POST(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Send the font as the form field "file"' }, { status: 400 })
  if (file.size > MAX_FONT_BYTES) return Response.json({ error: 'The font is larger than 30 MB' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = fontType(bytes)
  if (!type) return Response.json({ error: 'The file is not a TrueType or OpenType font' }, { status: 400 })
  try {
    return Response.json(await uploadFont(brandId, bytes, type), { status: 201 })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
