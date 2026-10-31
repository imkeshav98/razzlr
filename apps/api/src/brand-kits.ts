// Brand kits (#53): one per brand, its colours and fonts that designs bind to as `brand:<token>`,
// its logo and its tone of voice. A brand that never saved one has the empty kit.
import { brandKits, type Db } from '@razzlr/db'
import { EMPTY_BRAND_KIT, type BrandKit } from '@razzlr/schema'
import { and, eq } from 'drizzle-orm'
import { findAsset } from './assets.ts'

export async function getBrandKit(db: Db, workspaceId: string, brandId: string): Promise<BrandKit> {
  const [row] = await db.select().from(brandKits).where(and(eq(brandKits.brandId, brandId), eq(brandKits.workspaceId, workspaceId)))
  return row ? { colors: row.colors, fonts: row.fonts, logoAssetId: row.logoAssetId, voice: row.voice } : EMPTY_BRAND_KIT
}

export class InvalidKit extends Error {}

/** Saves the brand's whole kit. Its logo has to be an asset of the same brand. */
export async function saveBrandKit(db: Db, workspaceId: string, brandId: string, kit: BrandKit): Promise<BrandKit> {
  if (kit.logoAssetId && !(await findAsset(db, workspaceId, brandId, { id: kit.logoAssetId }))) throw new InvalidKit('The logo is not an asset of this brand')
  const values = { colors: kit.colors, fonts: kit.fonts, logoAssetId: kit.logoAssetId, voice: kit.voice, updatedAt: new Date() }
  await db.insert(brandKits).values({ brandId, workspaceId, ...values }).onConflictDoUpdate({ target: brandKits.brandId, set: values })
  return getBrandKit(db, workspaceId, brandId)
}
