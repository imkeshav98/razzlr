// Sends an image to the brand's asset library (#52) through the web app, which uploads it to
// storage and records it, telling how much has gone. Used by the editor's library and the brief.
import { AssetSummary } from '@razzlr/schema'

/** The image types the library takes; the web app checks the bytes again. */
export const ASSET_ACCEPT = 'image/png,image/jpeg,image/webp'

const base = (brandId: string) => `/brands/${encodeURIComponent(brandId)}/assets`

/** Sends one file to the web app, which uploads it to storage and records it, telling how much has gone. */
export function sendAsset(brandId: string, file: File, onProgress: (share: number) => void): Promise<AssetSummary> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', base(brandId))
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    request.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText)
      } catch {
        // Not JSON: the status says what went wrong.
      }
      if (request.status === 201) return resolve(AssetSummary.parse(body))
      const reason = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `${request.status}`
      reject(new Error(reason))
    }
    request.onerror = () => reject(new Error('no connection'))
    const form = new FormData()
    form.append('file', file)
    request.send(form)
  })
}

