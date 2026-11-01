'use server'

import { redirect } from 'next/navigation'
import { createBrand } from '../lib/api.ts'

/** Adds a brand (a client in an agency) by the name typed, and opens its home. */
export async function addBrand(form: FormData) {
  const name = String(form.get('name') ?? '').trim()
  if (!name) return
  const brand = await createBrand(name.slice(0, 120))
  redirect(`/brands/${brand.id}`)
}
