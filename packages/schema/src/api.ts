// The API's requests and responses. The API parses every body with these, and the web app reads
// every response with them, so the two can't drift apart.
import { z } from 'zod'
import { DesignMeta } from './design.ts'

/** Server-made ids of orgs, clients and designs. Design ids double as Yjs document names. */
export const RecordId = z.string().regex(/^[\w-]{1,64}$/, 'ids are 1–64 letters, digits, _ and -')

export const ClientSummary = z.object({
  id: RecordId,
  name: z.string(),
})
export type ClientSummary = z.infer<typeof ClientSummary>

export const CreateClient = z.object({
  name: z.string().trim().min(1).max(120),
})
export type CreateClient = z.infer<typeof CreateClient>

export const DesignSummary = z.object({
  id: RecordId,
  clientId: RecordId,
  name: z.string(),
  kind: DesignMeta.shape.kind,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type DesignSummary = z.infer<typeof DesignSummary>

export const CreateDesign = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * The design to start from, checked with parseDesign; its meta.designId and name are replaced
   * by the new design's. Left out, the design starts as one blank 1080×1080 page.
   */
  content: z.unknown().optional(),
})
export type CreateDesign = z.infer<typeof CreateDesign>

/** Every error the API sends: a short message a person can read. */
export const ApiError = z.object({
  error: z.string(),
})
export type ApiError = z.infer<typeof ApiError>
