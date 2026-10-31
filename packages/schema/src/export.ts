import { z } from 'zod'
import { FormatId, PageId } from './primitives.ts'

/** The image files an export makes (#55). JPG has no transparency, so it is drawn over white. */
export const ExportType = z.enum(['png', 'jpg'])
export type ExportType = z.infer<typeof ExportType>

/** The tokens a file name is built from. */
export const EXPORT_NAME_TOKENS = ['design', 'page', 'format'] as const
export const DEFAULT_EXPORT_NAME = '{design} - {page} - {format}'

/**
 * What to export from a design: some pages in some formats, as one image type. The same request
 * runs in the browser's export worker and in Node. More than one file comes as a zip with a
 * folder per format.
 */
export const ExportRequest = z.object({
  pageIds: PageId.array().min(1),
  formatIds: FormatId.array().min(1),
  type: ExportType,
  /** JPG quality, 1 to 100. */
  quality: z.number().int().min(1).max(100).default(90),
  /** The file name, from `{design}`, `{page}` and `{format}`; the extension is added. */
  name: z.string().min(1).max(200).default(DEFAULT_EXPORT_NAME),
})
export type ExportRequest = z.infer<typeof ExportRequest>
/** A request as a caller writes it, before the defaults are filled in. */
export type ExportRequestInput = z.input<typeof ExportRequest>
