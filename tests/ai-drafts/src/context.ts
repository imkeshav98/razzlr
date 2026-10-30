import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADS_DIR, type Ad } from './ad.ts'
import type { Kit } from './draw.ts'
import type { BrandFamily } from './fonts.ts'

/** What every step of one ad's run needs. */
export interface Context {
  ad: Ad
  kit: Kit
  families: BrandFamily[]
  /** The user's pictures for this ad, as bytes. */
  assets: { logo?: Uint8Array; product?: Uint8Array; people?: Uint8Array }
}

export function contextOf(ad: Ad, kit: Kit, families: BrandFamily[]): Context {
  const assets: Context['assets'] = {}
  for (const key of ['logo', 'product', 'people'] as const) {
    const file = ad.assets[key]
    if (!file) continue
    const path = join(ADS_DIR, 'assets', file)
    if (!existsSync(path)) throw new Error(`${ad.id}: missing asset ${path}`)
    assets[key] = new Uint8Array(readFileSync(path))
  }
  return { ad, kit, families, assets }
}
