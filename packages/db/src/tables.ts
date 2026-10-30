// The database's tables. Every row of agency data has an org, and every design a client of that
// org; the API scopes every query by them. Change these, then write a migration with
// `pnpm --filter @razzlr/db migration`.
import { customType, foreignKey, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
})

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const orgs = pgTable('orgs', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: createdAt(),
})

export const clients = pgTable('clients', {
  id: text().primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id),
  name: text().notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('clients_org').on(t.orgId),
  // Lets designs require that their client belongs to their org.
  unique('clients_id_org').on(t.id, t.orgId),
])

export const designs = pgTable('designs', {
  id: text().primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id),
  clientId: text('client_id').notNull(),
  name: text().notNull(),
  kind: text({ enum: ['single', 'carousel', 'story', 'document'] }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('designs_org_client').on(t.orgId, t.clientId),
  foreignKey({ name: 'designs_client_in_org', columns: [t.clientId, t.orgId], foreignColumns: [clients.id, clients.orgId] }),
])

/** Each design's Yjs state (ADR-0003), written by the sync server. */
export const designStates = pgTable('design_states', {
  designId: text('design_id').primaryKey().references(() => designs.id, { onDelete: 'cascade' }),
  state: bytea().notNull(),
  updatedAt: updatedAt(),
})

/**
 * An image a client uploaded. The original is stored once per org under its SHA-256
 * (orgs/<org>/originals/<sha256>); each client that uploads it gets one asset row.
 */
export const assets = pgTable('assets', {
  id: text().primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id),
  clientId: text('client_id').notNull(),
  sha256: text().notNull(),
  contentType: text('content_type', { enum: ['image/png', 'image/jpeg', 'image/webp'] }).notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique('assets_client_sha256').on(t.clientId, t.sha256),
  foreignKey({ name: 'assets_client_in_org', columns: [t.clientId, t.orgId], foreignColumns: [clients.id, clients.orgId] }),
])
