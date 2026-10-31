// Saves the design the editor holds as a template (#54). The API checks the design and that its
// images are the brand's own.
import { SaveTemplate } from '@razzlr/schema'
import { ApiFailure, saveTemplate } from '../../../../lib/api.ts'

export async function POST(request: Request, { params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const input = SaveTemplate.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: input.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  try {
    return Response.json(await saveTemplate(brandId, input.data), { status: 201 })
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 400 || e.status === 404)) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
