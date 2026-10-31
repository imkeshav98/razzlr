// The database's tables. Every row has a workspace, and every design and asset a brand of that
// workspace (ADR-0011); the API scopes every query by them. Change these, then write a migration with
// `pnpm --filter @razzlr/db migration`.
import { sql } from 'drizzle-orm'
import { check, customType, foreignKey, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
})

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const workspaces = pgTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
  /** Who the workspace is for; it changes defaults and words only, never what is stored. */
  kind: text({ enum: ['solo', 'company', 'agency'] }).notNull().default('agency'),
  createdAt: createdAt(),
})

export const brands = pgTable('brands', {
  id: text().primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  name: text().notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('brands_workspace').on(t.workspaceId),
  // Lets designs require that their brand belongs to their workspace.
  unique('brands_id_workspace').on(t.id, t.workspaceId),
])

export const designs = pgTable('designs', {
  id: text().primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  brandId: text('brand_id').notNull(),
  name: text().notNull(),
  kind: text({ enum: ['single', 'carousel', 'story', 'document'] }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('designs_workspace_brand').on(t.workspaceId, t.brandId),
  foreignKey({ name: 'designs_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
])

/** Each design's Yjs state (ADR-0003), written by the sync server. */
export const designStates = pgTable('design_states', {
  designId: text('design_id').primaryKey().references(() => designs.id, { onDelete: 'cascade' }),
  state: bytea().notNull(),
  updatedAt: updatedAt(),
})

/**
 * An image a brand uploaded. The original is stored once per workspace under its SHA-256
 * (workspaces/<workspace>/originals/<sha256>); each brand that uploads it gets one asset row.
 */
export const assets = pgTable('assets', {
  id: text().primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  brandId: text('brand_id').notNull(),
  sha256: text().notNull(),
  contentType: text('content_type', { enum: ['image/png', 'image/jpeg', 'image/webp'] }).notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique('assets_brand_sha256').on(t.brandId, t.sha256),
  foreignKey({ name: 'assets_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
])

/**
 * One font file (#50): a family in one weight and style. Google Fonts faces are shared by every
 * workspace and have no workspace or brand (stored at fonts/google/<sha256>); a brand's uploads
 * are its own (workspaces/<workspace>/fonts/<sha256>). A family name is unique per brand, weight
 * and style, so uploading a face again replaces it.
 */
export const fontFaces = pgTable('font_faces', {
  id: text().primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  brandId: text('brand_id'),
  source: text({ enum: ['google', 'upload'] }).notNull(),
  family: text().notNull(),
  weight: integer().notNull(),
  style: text({ enum: ['normal', 'italic'] }).notNull(),
  /** Google's category, such as serif; null for uploads. */
  category: text(),
  sha256: text().notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique('font_faces_face').on(t.workspaceId, t.brandId, t.family, t.weight, t.style).nullsNotDistinct(),
  index('font_faces_brand').on(t.workspaceId, t.brandId),
  foreignKey({ name: 'font_faces_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
  check('font_faces_scope', sql`(${t.source} = 'google' and ${t.workspaceId} is null and ${t.brandId} is null) or (${t.source} = 'upload' and ${t.workspaceId} is not null and ${t.brandId} is not null)`),
])
