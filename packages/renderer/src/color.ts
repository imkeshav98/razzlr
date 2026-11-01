import type { CanvasKit } from '@dazbee/canvaskit'

/** A CanvasKit colour from the schema's `#RRGGBBAA`. */
export function color(ck: CanvasKit, hex: string) {
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  return ck.Color(n(1), n(3), n(5), n(7) / 255)
}
