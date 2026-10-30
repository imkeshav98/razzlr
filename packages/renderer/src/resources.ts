import type { CanvasKit, FontCollection, Image, TypefaceFontProvider } from 'canvaskit-wasm'
import type { Resources } from './draw.ts'

export interface ResourceBytes {
  /** Font files by family; the font's own name is ignored. Never system fonts (CLAUDE.md). */
  fonts: { family: string; bytes: Uint8Array }[]
  fallbackFamilies: string[]
  /** Encoded images (PNG, JPEG, WebP) by asset id, from originals or renditions we store. */
  images: Record<string, Uint8Array>
}

/** Registers fonts and decodes images with CanvasKit itself, so every runtime reads the same bytes the same way. */
export function makeResources(ck: CanvasKit, bytes: ResourceBytes): Resources & { delete(): void } {
  const cache = resourceCache(ck)
  try {
    return { ...cache.resources(bytes), delete: cache.delete }
  } catch (error) {
    cache.delete()
    throw error
  }
}

/**
 * Keeps registered fonts and decoded images between renders (#30). Each call to `resources` gives
 * what those bytes describe: images and fonts seen before are reused, new ones are decoded, and
 * any no longer named are freed. Bytes are told apart by their array object, so changed bytes must
 * come as a new array. Resources from an earlier call stay usable only until the next one.
 */
export function resourceCache(ck: CanvasKit) {
  const images = new Map<string, { bytes: Uint8Array; image: Image }>()
  let fonts: { list: ResourceBytes['fonts']; provider: TypefaceFontProvider; collection: FontCollection } | undefined

  const sameFonts = (a: ResourceBytes['fonts'], b: ResourceBytes['fonts']) =>
    a.length === b.length && a.every((f, i) => f.family === b[i]?.family && f.bytes === b[i]?.bytes)

  function fontsFor(list: ResourceBytes['fonts']) {
    if (fonts && sameFonts(fonts.list, list)) return fonts.collection
    // A provider can't drop a font, so a changed set of fonts is registered again from scratch.
    const provider = ck.TypefaceFontProvider.Make()
    for (const font of list) provider.registerFont(font.bytes, font.family)
    const collection = ck.FontCollection.Make()
    collection.setDefaultFontManager(provider)
    freeFonts()
    fonts = { list: [...list], provider, collection }
    return collection
  }

  function freeFonts() {
    fonts?.collection.delete()
    fonts?.provider.delete()
    fonts = undefined
  }

  function imagesFor(wanted: ResourceBytes['images']) {
    for (const [id, entry] of images) {
      if (wanted[id] !== entry.bytes) {
        entry.image.delete()
        images.delete(id)
      }
    }
    for (const [id, encoded] of Object.entries(wanted)) {
      if (images.has(id)) continue
      const image = ck.MakeImageFromEncoded(encoded)
      if (!image) throw new Error(`CanvasKit can't decode the image for asset "${id}"`)
      images.set(id, { bytes: encoded, image })
    }
    return new Map([...images].map(([id, { image }]) => [id, image]))
  }

  return {
    resources(bytes: ResourceBytes): Resources {
      return { fonts: fontsFor(bytes.fonts), fallbackFamilies: [...bytes.fallbackFamilies], images: imagesFor(bytes.images) }
    },
    delete() {
      for (const { image } of images.values()) image.delete()
      images.clear()
      freeFonts()
    },
  }
}
export type ResourceCache = ReturnType<typeof resourceCache>
