// The workspace, its brands and their designs, always read and written within one workspace.
import { randomUUID } from 'node:crypto'
import { brands, designs, designStates, workspaces, type Db } from '@razzlr/db'
import { loadDesign } from '@razzlr/doc'
import { parseDesign, SCHEMA_VERSION, type BrandSummary, type DesignInput, type DesignSummary, type WorkspaceKind, type WorkspaceSummary } from '@razzlr/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import * as Y from 'yjs'

const workspaceSummary = { id: workspaces.id, name: workspaces.name, kind: workspaces.kind }

export async function findWorkspace(db: Db, workspaceId: string): Promise<WorkspaceSummary | null> {
  const [row] = await db.select(workspaceSummary).from(workspaces).where(eq(workspaces.id, workspaceId))
  return row ?? null
}

export async function setWorkspaceKind(db: Db, workspaceId: string, kind: WorkspaceKind): Promise<WorkspaceSummary | null> {
  const [row] = await db.update(workspaces).set({ kind }).where(eq(workspaces.id, workspaceId)).returning(workspaceSummary)
  return row ?? null
}

export async function listBrands(db: Db, workspaceId: string): Promise<BrandSummary[]> {
  return db.select({ id: brands.id, name: brands.name }).from(brands)
    .where(eq(brands.workspaceId, workspaceId)).orderBy(asc(brands.name), asc(brands.id))
}

export async function createBrand(db: Db, workspaceId: string, name: string): Promise<BrandSummary> {
  const [row] = await db.insert(brands).values({ id: randomUUID(), workspaceId, name }).returning({ id: brands.id, name: brands.name })
  if (!row) throw new Error('insert returned no brand')
  return row
}

export async function findBrand(db: Db, workspaceId: string, brandId: string): Promise<BrandSummary | null> {
  const [row] = await db.select({ id: brands.id, name: brands.name }).from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.workspaceId, workspaceId)))
  return row ?? null
}

const summary = {
  id: designs.id, brandId: designs.brandId, name: designs.name, kind: designs.kind,
  createdAt: designs.createdAt, updatedAt: designs.updatedAt,
}
const toSummary = (row: { id: string; brandId: string; name: string; kind: DesignSummary['kind']; createdAt: Date; updatedAt: Date }): DesignSummary =>
  ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })

export async function listDesigns(db: Db, workspaceId: string, brandId: string): Promise<DesignSummary[]> {
  const rows = await db.select(summary).from(designs)
    .where(and(eq(designs.workspaceId, workspaceId), eq(designs.brandId, brandId))).orderBy(desc(designs.updatedAt), asc(designs.id))
  return rows.map(toSummary)
}

export async function findDesign(db: Db, workspaceId: string, brandId: string, designId: string): Promise<DesignSummary | null> {
  const [row] = await db.select(summary).from(designs)
    .where(and(eq(designs.id, designId), eq(designs.workspaceId, workspaceId), eq(designs.brandId, brandId)))
  return row ? toSummary(row) : null
}

/** One blank 1080×1080 page: what a design starts as when nothing else is given. */
export const blankDesign = (designId: string, name: string): DesignInput => ({
  meta: { schemaVersion: SCHEMA_VERSION, designId, name, kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {},
  overrides: {},
})

export class InvalidContent extends Error {}

/**
 * Creates a design and its first Yjs state together, so the editor never opens a design with
 * nothing in it. `content` is checked like any design; its id and name become the new design's.
 */
export async function createDesign(db: Db, workspaceId: string, brandId: string, name: string, content?: unknown): Promise<DesignSummary> {
  const id = randomUUID()
  const input = content === undefined ? blankDesign(id, name) : withMeta(content, id, name)
  const parsed = parseDesign(input)
  if (!parsed.success) throw new InvalidContent(parsed.errors.slice(0, 5).join('; '))
  const state = Y.encodeStateAsUpdate(loadDesign(parsed.design))
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(designs).values({ id, workspaceId, brandId, name, kind: parsed.design.meta.kind }).returning(summary)
    if (!row) throw new Error('insert returned no design')
    await tx.insert(designStates).values({ designId: id, state })
    return toSummary(row)
  })
}

function withMeta(content: unknown, designId: string, name: string): unknown {
  if (typeof content !== 'object' || content === null || !('meta' in content)) return content
  const { meta } = content as { meta: unknown }
  return { ...content, meta: typeof meta === 'object' && meta !== null ? { ...meta, designId, name } : meta }
}
