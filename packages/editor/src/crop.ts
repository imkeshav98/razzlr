// Cropping an image fill on the stage (#48): where the whole image sits for a crop, and the crop a
// pan or a corner drag of it gives. All in the layer's own, unturned coordinates. Kept free of the
// editor so it can be tested on its own.

/** A rectangle, unturned. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** The crop that shows what fill shows: the image covering the box, centred. */
export function coverCrop(image: Size, box: Size): Rect {
  const scale = Math.max(box.width / image.width, box.height / image.height)
  const width = box.width / scale
  const height = box.height / scale
  return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height }
}

/** Where the whole image sits when a crop of it is stretched over a box. */
export function imageRect(crop: Rect, image: Size, box: Rect): Rect {
  const sx = box.width / crop.width
  const sy = box.height / crop.height
  return { x: box.x - crop.x * sx, y: box.y - crop.y * sy, width: image.width * sx, height: image.height * sy }
}

/** The crop of an image placed at a rect that a box shows. */
export function cropOf(rect: Rect, image: Size, box: Rect): Rect {
  const sx = rect.width / image.width
  const sy = rect.height / image.height
  return { x: (box.x - rect.x) / sx, y: (box.y - rect.y) / sy, width: box.width / sx, height: box.height / sy }
}

/** The image moved by a drag, kept covering the box: it stops at its edges. */
export function panned(rect: Rect, box: Rect, dx: number, dy: number): Rect {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    ...rect,
    x: clamp(rect.x + dx, box.x + box.width - rect.width, box.x),
    y: clamp(rect.y + dy, box.y + box.height - rect.height, box.y),
  }
}

/**
 * The image scaled by dragging one of its corners (0 top start, 1 top end, 2 bottom end, 3 bottom
 * start) to a point: the opposite corner stays, the aspect is kept, and it never gets too small to
 * cover the box.
 */
export function scaled(rect: Rect, box: Rect, corner: number, p: { x: number; y: number }): Rect {
  const right = corner === 1 || corner === 2
  const bottom = corner === 2 || corner === 3
  const fixed = { x: right ? rect.x : rect.x + rect.width, y: bottom ? rect.y : rect.y + rect.height }
  // How big the pointer asks for, along the image's diagonal.
  const along = Math.max(Math.abs(p.x - fixed.x) / rect.width, Math.abs(p.y - fixed.y) / rect.height)
  // How big it must stay to still reach the box's far edges from the corner that stays.
  const least = Math.max(
    (right ? box.x + box.width - fixed.x : fixed.x - box.x) / rect.width,
    (bottom ? box.y + box.height - fixed.y : fixed.y - box.y) / rect.height,
  )
  const k = Math.max(along, least)
  const width = rect.width * k
  const height = rect.height * k
  return { x: right ? fixed.x : fixed.x - width, y: bottom ? fixed.y : fixed.y - height, width, height }
}

/** A rect's corners in the order `scaled` numbers them. */
export const cornersOfRect = (r: Rect) => [
  { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height },
]
