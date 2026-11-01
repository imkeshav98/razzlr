'use server'

// What the brand's pages do to its designs and templates (#54, #159): each takes the brand first,
// so a page binds it, and the page draws again with the change.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { deleteDesign, deleteTemplate, duplicateDesign, renameDesign, renameTemplate, startFromTemplate } from '../../../lib/api.ts'

/** The name a rename form sends, trimmed to what the API takes. */
const nameOf = (form: FormData) => String(form.get('name') ?? '').trim().slice(0, 120)

const changed = (brandId: string) => revalidatePath(`/brands/${brandId}`, 'layout')

/** Starts a design from a template: the brand's own copy, with fresh ids. */
export async function startTemplate(brandId: string, templateId: string) {
  const design = await startFromTemplate(brandId, templateId)
  redirect(`/brands/${brandId}/designs/${design.id}`)
}

export async function renameDesignAction(brandId: string, designId: string, form: FormData) {
  const name = nameOf(form)
  if (name) await renameDesign(brandId, designId, name)
  changed(brandId)
}

export async function duplicateDesignAction(brandId: string, designId: string) {
  await duplicateDesign(brandId, designId)
  changed(brandId)
}

export async function deleteDesignAction(brandId: string, designId: string) {
  await deleteDesign(brandId, designId)
  changed(brandId)
}

export async function renameTemplateAction(brandId: string, templateId: string, form: FormData) {
  const name = nameOf(form)
  if (name) await renameTemplate(brandId, templateId, name)
  changed(brandId)
}

export async function deleteTemplateAction(brandId: string, templateId: string) {
  await deleteTemplate(brandId, templateId)
  changed(brandId)
}
