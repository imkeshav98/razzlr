// Clients and designs, always read and written within one org.
import { randomUUID } from 'node:crypto'
import { clients, designs, designStates, type Db } from '@razzlr/db'
import { loadDesign } from '@razzlr/doc'
import { parseDesign, type ClientSummary, type DesignInput, type DesignSummary } from '@razzlr/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import * as Y from 'yjs'

export async function listClients(db: Db, orgId: string): Promise<ClientSummary[]> {
  return db.select({ id: clients.id, name: clients.name }).from(clients)
    .where(eq(clients.orgId, orgId)).orderBy(asc(clients.name), asc(clients.id))
}

export async function createClient(db: Db, orgId: string, name: string): Promise<ClientSummary> {
  const [row] = await db.insert(clients).values({ id: randomUUID(), orgId, name }).returning({ id: clients.id, name: clients.name })
  if (!row) throw new Error('insert returned no client')
  return row
}

export async function findClient(db: Db, orgId: string, clientId: string): Promise<ClientSummary | null> {
  const [row] = await db.select({ id: clients.id, name: clients.name }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)))
  return row ?? null
}

const summary = {
  id: designs.id, clientId: designs.clientId, name: designs.name, kind: designs.kind,
  createdAt: designs.createdAt, updatedAt: designs.updatedAt,
}
const toSummary = (row: { id: string; clientId: string; name: string; kind: DesignSummary['kind']; createdAt: Date; updatedAt: Date }): DesignSummary =>
  ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })

export async function listDesigns(db: Db, orgId: string, clientId: string): Promise<DesignSummary[]> {
  const rows = await db.select(summary).from(designs)
    .where(and(eq(designs.orgId, orgId), eq(designs.clientId, clientId))).orderBy(desc(designs.updatedAt), asc(designs.id))
  return rows.map(toSummary)
}

export async function findDesign(db: Db, orgId: string, clientId: string, designId: string): Promise<DesignSummary | null> {
  const [row] = await db.select(summary).from(designs)
    .where(and(eq(designs.id, designId), eq(designs.orgId, orgId), eq(designs.clientId, clientId)))
  return row ? toSummary(row) : null
}

/** One blank 1080×1080 page: what a design starts as when nothing else is given. */
export const blankDesign = (designId: string, name: string): DesignInput => ({
  meta: { schemaVersion: 1, designId, name, kind: 'single', primaryFormatId: 'sq' },
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
export async function createDesign(db: Db, orgId: string, clientId: string, name: string, content?: unknown): Promise<DesignSummary> {
  const id = randomUUID()
  const input = content === undefined ? blankDesign(id, name) : withMeta(content, id, name)
  const parsed = parseDesign(input)
  if (!parsed.success) throw new InvalidContent(parsed.errors.slice(0, 5).join('; '))
  const state = Y.encodeStateAsUpdate(loadDesign(parsed.design))
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(designs).values({ id, orgId, clientId, name, kind: parsed.design.meta.kind }).returning(summary)
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
