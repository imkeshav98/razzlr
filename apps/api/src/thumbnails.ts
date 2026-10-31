// The small copy of an image the asset library shows (#52). ADR-0010: resized copies are images we
// make and store as their own objects, never resized on the fly. CanvasKit decodes the original, as
// it does for every render.
import { loadCanvasKit } from '@razzlr/renderer/node'
import type { ImageType } from '@razzlr/schema'

/** The longest side of a thumbnail, in pixels: two library columns on a 2× screen. */
export const THUMBNAIL_SIZE = 320

export interface Thumbnail { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }

/**
 * The image scaled down to fit `size` (never up), THUMBNAIL_SIZE unless given. A JPEG stays a JPEG; PNG and WebP, which
 * can be see-through, become PNG. Throws when CanvasKit can't decode the original.
 */
export async function makeThumbnail(bytes: Uint8Array, contentType: ImageType, size = THUMBNAIL_SIZE): Promise<Thumbnail> {
  const ck = await loadCanvasKit()
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new Error('CanvasKit can\'t decode this image')
  try {
    const scale = Math.min(1, size / Math.max(image.width(), image.height()))
    const width = Math.max(1, Math.round(image.width() * scale))
    const height = Math.max(1, Math.round(image.height() * scale))
    const surface = ck.MakeSurface(width, height)
    if (!surface) throw new Error('could not make a surface for the thumbnail')
    try {
      // Mipmapped, so a photo several times the size shrinks without shimmering edges.
      surface.getCanvas().drawImageRectOptions(image, ck.XYWHRect(0, 0, image.width(), image.height()), ck.XYWHRect(0, 0, width, height), ck.FilterMode.Linear, ck.MipmapMode.Linear, null)
      const snapshot = surface.makeImageSnapshot()
      const jpeg = contentType === 'image/jpeg'
      const encoded = jpeg ? snapshot.encodeToBytes(ck.ImageFormat.JPEG, 82) : snapshot.encodeToBytes()
      snapshot.delete()
      if (!encoded) throw new Error('could not encode the thumbnail')
      return { bytes: encoded, contentType: jpeg ? 'image/jpeg' : 'image/png' }
    } finally {
      surface.delete()
    }
  } finally {
    image.delete()
  }
}
