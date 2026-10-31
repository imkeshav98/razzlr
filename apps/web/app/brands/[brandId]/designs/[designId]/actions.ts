'use server'

import { syncToken } from '../../../../../lib/api.ts'

/** A fresh sync token for the editor, after the API's workspace and brand checks. */
export async function fetchSyncToken(brandId: string, designId: string): Promise<string> {
  return (await syncToken(brandId, designId)).token
}
