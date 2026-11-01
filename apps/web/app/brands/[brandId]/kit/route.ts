// The brand's kit for the editor (#53): read it, and save it whole.
import { BrandKit } from '@dazbee/schema'
import { ApiFailure, getBrandKit, saveBrandKit } from '../../../../lib/api.ts'

const failure = (e: unknown) => {
  if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
  throw e
}

export async function GET(_request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  try {
    return Response.json(await getBrandKit(brandId), { headers: { 'cache-control': 'private, no-store' } })
  } catch (e) {
    return failure(e)
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const kit = BrandKit.safeParse(await request.json().catch(() => null))
  if (!kit.success) return Response.json({ error: kit.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  try {
    return Response.json(await saveBrandKit(brandId, kit.data))
  } catch (e) {
    return failure(e)
  }
}
