'use server'

import { syncToken } from '../../../../../lib/api.ts'

/** A fresh sync token for the editor, after the API's org and client checks. */
export async function fetchSyncToken(clientId: string, designId: string): Promise<string> {
  return (await syncToken(clientId, designId)).token
}
