'use server'

import { redirect } from 'next/navigation'
import { deleteDesign, renameDesign, startFromTemplate, syncToken } from '../../../../../lib/api.ts'

/** Renames the design from the editor's crumb (#159); the name it has now, or the old one for an empty name. */
export async function renameFromEditor(brandId: string, designId: string, name: string): Promise<string> {
  const trimmed = name.trim().slice(0, 120)
  if (!trimmed) throw new Error('A design needs a name')
  return (await renameDesign(brandId, designId, trimmed)).name
}

/**
 * Turns a design just made, still empty, into a copy of a template (the new design screen): the
 * copy is made, the empty design goes, and the editor opens the copy.
 */
export async function startDesignFromTemplate(brandId: string, designId: string, templateId: string) {
  const made = await startFromTemplate(brandId, templateId)
  await deleteDesign(brandId, designId)
  redirect(`/brands/${brandId}/designs/${made.id}`)
}

/** A fresh sync token for the editor, after the API's workspace and brand checks. */
export async function fetchSyncToken(brandId: string, designId: string): Promise<string> {
  return (await syncToken(brandId, designId)).token
}
