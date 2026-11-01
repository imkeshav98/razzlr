// The database's tables. Every row has a workspace, and every design and asset a brand of that
// workspace (ADR-0011); the API scopes every query by them. Change these, then write a migration with
// `pnpm --filter @dazbee/db migration`.
import { sql } from 'drizzle-orm'
import { check, customType, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core'

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
  /** Its WorkOS organization (#58); null for a workspace made before sign-in, such as the development one. */
  workosOrganizationId: text('workos_organization_id').unique(),
  createdAt: createdAt(),
})

/** A person who signed in with WorkOS (#58), known by their WorkOS user id. */
export const users = pgTable('users', {
  id: text().primaryKey(),
  workosUserId: text('workos_user_id').notNull().unique(),
  email: text().notNull(),
  name: text().notNull().default(''),
  createdAt: createdAt(),
})

/**
 * A person's place in a workspace (#58, ADR-0011): one per workspace they belong to, with their role.
 * A session is always for one of these; removing it ends that person's sessions there.
 */
export const memberships = pgTable('memberships', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text({ enum: ['owner', 'admin', 'editor', 'reviewer'] }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index('memberships_user').on(t.userId),
])

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
 * (workspaces/<workspace>/originals/<sha256>), with a small copy for the asset library next to it
 * (workspaces/<workspace>/thumbnails/<sha256>); each brand that uploads it gets one asset row, with
 * its own name and tags (#52).
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
  /** What the brand calls it; the file's name when it was uploaded. */
  name: text().notNull().default(''),
  /** Lowercase words the brand searches by, each once. */
  tags: text().array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
}, (t) => [
  unique('assets_brand_sha256').on(t.brandId, t.sha256),
  foreignKey({ name: 'assets_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
])

/**
 * A brand's kit (#53): the colours and fonts designs bind to as `brand:<token>`, its logo and its
 * tone of voice. One row per brand, made the first time the kit is saved.
 */
export const brandKits = pgTable('brand_kits', {
  brandId: text('brand_id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  colors: jsonb().$type<{ token: string; name: string; value: string }[]>().notNull().default([]),
  fonts: jsonb().$type<{ token: string; name: string; family: string }[]>().notNull().default([]),
  logoAssetId: text('logo_asset_id').references(() => assets.id, { onDelete: 'set null' }),
  voice: text().notNull().default(''),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ name: 'brand_kits_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
])

/**
 * A design saved to start others from (#54): its own copy of the document, as it was saved, and a
 * thumbnail in storage (workspaces/<workspace>/templates/<id>.png). A workspace template (no brand)
 * is for every brand of the workspace; a brand template for that brand only. Its images are assets
 * of the brand it was saved from; a design started in another brand gets its own assets of them.
 */
export const templates = pgTable('templates', {
  id: text().primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  /** Null for a workspace template. */
  brandId: text('brand_id'),
  /** The brand whose design it was saved from, which owns the assets its images name. */
  fromBrandId: text('from_brand_id').notNull(),
  name: text().notNull(),
  kind: text({ enum: ['single', 'carousel', 'story', 'document'] }).notNull(),
  content: jsonb().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('templates_workspace').on(t.workspaceId),
  foreignKey({ name: 'templates_brand_in_workspace', columns: [t.brandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
  foreignKey({ name: 'templates_from_brand_in_workspace', columns: [t.fromBrandId, t.workspaceId], foreignColumns: [brands.id, brands.workspaceId] }),
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
