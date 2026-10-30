// Reads an image's type and size from its header, so the API can refuse what isn't the image it
// claims to be before recording it. Decoding stays with CanvasKit in the renderer.
import type { ImageType } from '@razzlr/schema'

export interface ImageHeader { contentType: ImageType; width: number; height: number }

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))

export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const has = (n: number) => bytes.length >= n
  // PNG: signature, then IHDR with width and height.
  if (has(24) && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && ascii(bytes, 12, 4) === 'IHDR') {
    return sized('image/png', view.getUint32(16), view.getUint32(20))
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (has(4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (has(at + 9)) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1] ?? 0
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
        at += marker === 0xff ? 1 : 2
        continue
      }
      const length = view.getUint16(at + 2)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return sized('image/jpeg', view.getUint16(at + 7), view.getUint16(at + 5))
      at += 2 + length
    }
    return null
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X chunk.
  if (has(30) && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4)
    if (chunk === 'VP8 ') return sized('image/webp', view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    if (chunk === 'VP8L') {
      const b = view.getUint32(21, true)
      return sized('image/webp', (b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') {
      const w = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)
      const h = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)
      return sized('image/webp', w + 1, h + 1)
    }
  }
  return null
}

const sized = (contentType: ImageType, width: number, height: number): ImageHeader | null =>
  width > 0 && height > 0 && width <= 16_384 && height <= 16_384 ? { contentType, width, height } : null
