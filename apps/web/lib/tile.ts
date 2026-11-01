/** A calm two-colour tile for something with no picture, steady for each id. */
export function tileOf(id: string) {
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.45 0.12 ${(hue + 40) % 360}))`
}
