// Templates (#54): a design saved, as its own copy, to start others from. A workspace template is
// for every brand of the workspace, a brand template for its brand only. Starting from one makes a
// new design of the brand with fresh ids; where the brand isn't the one the template was saved
// from, the images it names become assets of the brand too, so nothing crosses the brand wall.
import { randomUUID } from 'node:crypto'
import { assets, templates, type Db } from '@razzlr/db'
import { withFreshIds } from '@razzlr/doc'
import { imageAssetIds, parseDesign, type Design, type DesignSummary, type TemplateScope, type TemplateSummary } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { findAsset } from './assets.ts'
import { createDesign, InvalidContent } from './designs.ts'
import { renderFirstPage } from './render.ts'
import { makeThumbnail } from './thumbnails.ts'

export const templateThumbnailKey = (workspaceId: string, templateId: string) => `workspaces/${workspaceId}/templates/${templateId}.png`

const summary = {
  id: templates.id, name: templates.name, brandId: templates.brandId, kind: templates.kind,
  width: templates.width, height: templates.height, createdAt: templates.createdAt,
}
type Row = { id: string; name: string; brandId: string | null; kind: TemplateSummary['kind']; width: number; height: number; createdAt: Date }
const toSummary = (row: Row): TemplateSummary => ({ ...row, scope: row.brandId ? 'brand' : 'workspace', createdAt: row.createdAt.toISOString() })

/** What a brand can start from: the workspace's templates and its own. */
const visibleTo = (workspaceId: string, brandId: string) =>
  and(eq(templates.workspaceId, workspaceId), or(isNull(templates.brandId), eq(templates.brandId, brandId)))

/** The templates a brand can start from, newest first. */
export async function listTemplates(db: Db, workspaceId: string, brandId: string): Promise<TemplateSummary[]> {
  const rows = await db.select(summary).from(templates).where(visibleTo(workspaceId, brandId)).orderBy(desc(templates.createdAt), desc(templates.id))
  return rows.map(toSummary)
}

async function visibleTemplate(db: Db, workspaceId: string, brandId: string, id: string) {
  const [row] = await db.select().from(templates).where(and(eq(templates.id, id), visibleTo(workspaceId, brandId)))
  return row ?? null
}

/** Renames a template the brand can see; null when it can't. */
export async function renameTemplate(db: Db, workspaceId: string, brandId: string, id: string, name: string): Promise<TemplateSummary | null> {
  if (!await visibleTemplate(db, workspaceId, brandId, id)) return null
  const [row] = await db.update(templates).set({ name }).where(eq(templates.id, id)).returning(summary)
  return row ? toSummary(row) : null
}

/** Deletes a template the brand can see, and its picture; false when it can't see one. */
export async function deleteTemplate(db: Db, storage: Storage, workspaceId: string, brandId: string, id: string): Promise<boolean> {
  if (!await visibleTemplate(db, workspaceId, brandId, id)) return false
  await db.delete(templates).where(eq(templates.id, id))
  await storage.delete(templateThumbnailKey(workspaceId, id)).catch(() => undefined)
  return true
}

export const findTemplate = async (db: Db, workspaceId: string, brandId: string, id: string) => {
  const row = await visibleTemplate(db, workspaceId, brandId, id)
  return row ? toSummary(row) : null
}

/**
 * Saves `content`, a design of the brand, as a template with its thumbnail. Every image it names
 * has to be an asset of the brand.
 */
export async function saveTemplate(db: Db, storage: Storage, workspaceId: string, brandId: string, input: { name: string; scope: TemplateScope; content: unknown }): Promise<TemplateSummary> {
  const parsed = parseDesign(input.content)
  if (!parsed.success) throw new InvalidContent(parsed.errors.slice(0, 5).join('; '))
  const design = parsed.design
  for (const assetId of imageAssetIds(design)) {
    if (!(await findAsset(db, workspaceId, brandId, { id: assetId }))) throw new InvalidContent(`the image "${assetId}" is not an asset of this brand`)
  }
  const format = design.formats[design.meta.primaryFormatId]
  if (!format) throw new InvalidContent('the design has no primary format')
  const id = randomUUID()
  const rendered = await renderFirstPage(db, storage, workspaceId, brandId, design)
  const thumbnail = await makeThumbnail(rendered.png, 'image/png')
  await storage.put(templateThumbnailKey(workspaceId, id), thumbnail.bytes, thumbnail.contentType)
  const [row] = await db.insert(templates).values({
    id, workspaceId, brandId: input.scope === 'brand' ? brandId : null, fromBrandId: brandId, name: input.name,
    kind: design.meta.kind, content: design, width: format.width, height: format.height,
  }).returning(summary)
  if (!row) throw new Error('insert returned no template')
  return toSummary(row)
}

/**
 * The brand's asset for each image the template names, made from the same stored original where
 * the brand has none: asset ids by the template's ids.
 */
async function assetsFor(db: Db, workspaceId: string, fromBrandId: string, brandId: string, ids: string[]): Promise<Map<string, string>> {
  const mapped = new Map<string, string>()
  for (const id of ids) {
    const source = await findAsset(db, workspaceId, fromBrandId, { id })
    if (!source) continue
    const own = await findAsset(db, workspaceId, brandId, { sha256: source.sha256 })
    if (own) {
      mapped.set(id, own.id)
      continue
    }
    const copy = randomUUID()
    await db.insert(assets).values({
      id: copy, workspaceId, brandId, sha256: source.sha256, contentType: source.contentType, byteSize: source.byteSize,
      width: source.width, height: source.height, name: source.name, tags: source.tags,
    }).onConflictDoNothing()
    mapped.set(id, (await findAsset(db, workspaceId, brandId, { sha256: source.sha256 }))?.id ?? copy)
  }
  return mapped
}

/** Swaps the asset ids image fills name, wherever they are. */
function withAssets(design: Design, mapped: Map<string, string>): unknown {
  let json = JSON.stringify(design)
  for (const [from, to] of mapped) if (from !== to) json = json.replaceAll(`"assetId":${JSON.stringify(from)}`, `"assetId":${JSON.stringify(to)}`)
  return JSON.parse(json)
}

/** A new design of the brand from the template, sharing no ids with it; null without such a template. */
export async function startFromTemplate(db: Db, workspaceId: string, brandId: string, templateId: string, name?: string): Promise<DesignSummary | null> {
  const row = await visibleTemplate(db, workspaceId, brandId, templateId)
  if (!row) return null
  const parsed = parseDesign(row.content)
  if (!parsed.success) throw new Error(`template ${row.id} is not a valid design: ${parsed.errors[0]}`)
  const fresh = withFreshIds(parsed.design)
  const mapped = row.fromBrandId === brandId ? new Map<string, string>() : await assetsFor(db, workspaceId, row.fromBrandId, brandId, imageAssetIds(fresh))
  return createDesign(db, workspaceId, brandId, name ?? row.name, withAssets(fresh, mapped))
}
