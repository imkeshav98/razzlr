// The API's requests and responses. The API parses every body with these, and the web app reads
// every response with them, so the two can't drift apart.
import { z } from 'zod'
import { DesignMeta } from './design.ts'
import { Color } from './primitives.ts'
import { BrandToken, brandRef, type Variables } from './variables.ts'

/** Server-made ids of workspaces, brands and designs. Design ids double as Yjs document names. */
export const RecordId = z.string().regex(/^[\w-]{1,64}$/, 'ids are 1–64 letters, digits, _ and -')

/** Who a workspace is for (ADR-0011). It changes defaults and words only: an agency's brands are its clients. */
export const WorkspaceKind = z.enum(['solo', 'company', 'agency'])
export type WorkspaceKind = z.infer<typeof WorkspaceKind>

export const WorkspaceSummary = z.object({
  id: RecordId,
  name: z.string(),
  kind: WorkspaceKind,
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>

/** Who the workspace is for, its name, or both. */
export const UpdateWorkspace = z.object({
  kind: WorkspaceKind.optional(),
  name: z.string().trim().min(1).max(120).optional(),
}).refine((input) => input.kind !== undefined || input.name !== undefined, 'give a kind, a name or both')
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>

export const BrandSummary = z.object({
  id: RecordId,
  name: z.string(),
})
export type BrandSummary = z.infer<typeof BrandSummary>

export const CreateBrand = z.object({
  name: z.string().trim().min(1).max(120),
})
export type CreateBrand = z.infer<typeof CreateBrand>

export const DesignSummary = z.object({
  id: RecordId,
  brandId: RecordId,
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

/** Lets the editor open one design on the sync server until it expires. */
export const SyncToken = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
})
export type SyncToken = z.infer<typeof SyncToken>

/** The image types we accept and decode with CanvasKit (ADR-0006: images are fills). */
export const ImageType = z.enum(['image/png', 'image/jpeg', 'image/webp'])
export type ImageType = z.infer<typeof ImageType>

/** Largest original we accept, in bytes. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 is 64 lowercase hex digits')

export const AssetSummary = z.object({
  id: RecordId,
  brandId: RecordId,
  sha256: Sha256,
  contentType: ImageType,
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
})
export type AssetSummary = z.infer<typeof AssetSummary>

/** Asks to upload an original; the API answers with the asset when it already has those bytes. */
export const StartUpload = z.object({
  sha256: Sha256,
  byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: ImageType,
  /** The asset's name, used when the API records it straight away. */
  name: z.string().trim().min(1).max(120).optional(),
})
export type StartUpload = z.infer<typeof StartUpload>

export const UploadTicket = z.union([
  z.object({ asset: AssetSummary, upload: z.null() }),
  /** PUT the bytes to url with these headers, then record the asset with its sha256. */
  z.object({ asset: z.null(), upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()), expiresAt: z.iso.datetime() }) }),
])
export type UploadTicket = z.infer<typeof UploadTicket>

/** What a brand calls an asset (#52). */
export const AssetName = z.string().trim().min(1).max(120)
/** A word a brand finds assets by: lowercase, without spaces at either end (#52). */
export const AssetTag = z.string().trim().toLowerCase().min(1).max(40)
/** Most tags one asset has. */
export const MAX_ASSET_TAGS = 20

export const RecordAsset = z.object({ sha256: Sha256, name: AssetName.optional() })
export type RecordAsset = z.infer<typeof RecordAsset>

/** Renames an asset or sets its tags (#52); tags are kept once each, in the order given. */
export const UpdateAsset = z.object({
  name: AssetName.optional(),
  tags: z.array(AssetTag).max(MAX_ASSET_TAGS).transform((tags) => [...new Set(tags)]).optional(),
}).refine((u) => u.name !== undefined || u.tags !== undefined, 'send a name, tags or both')
export type UpdateAsset = z.infer<typeof UpdateAsset>

/** A short-lived URL to read something from storage. */
export const SignedLink = z.object({ url: z.url(), expiresAt: z.iso.datetime() })
export type SignedLink = z.infer<typeof SignedLink>

/** The size of a design's primary format (#84), so a tile takes its shape before its picture loads. */
export const DesignCover = z.object({ width: z.number().int().positive(), height: z.number().int().positive() })
export type DesignCover = z.infer<typeof DesignCover>

/** A design's picture (#84): a short-lived URL, and the primary format's size. */
export const DesignThumbnail = SignedLink.extend(DesignCover.shape)
export type DesignThumbnail = z.infer<typeof DesignThumbnail>

/** An asset and a short-lived URL to read its original. */
export const AssetLink = z.object({
  asset: AssetSummary,
  url: z.url(),
  expiresAt: z.iso.datetime(),
})
export type AssetLink = z.infer<typeof AssetLink>

/** Font files we accept: TrueType and OpenType outlines, which CanvasKit reads itself (#50). */
export const FontType = z.enum(['font/ttf', 'font/otf'])
export type FontType = z.infer<typeof FontType>

/** Largest font file we accept, in bytes; a CJK family's face can be 20 MB. */
export const MAX_FONT_BYTES = 30 * 1024 * 1024

/** Where a family comes from: shipped with the app, copied from Google Fonts into our storage, or uploaded by a brand. */
export const FontSource = z.enum(['builtin', 'google', 'upload'])
export type FontSource = z.infer<typeof FontSource>

/** One font file: a family in one weight and style. */
export const FontFace = z.object({
  id: RecordId,
  family: z.string().min(1),
  weight: z.number().int().min(1).max(1000),
  style: z.enum(['normal', 'italic']),
  source: FontSource,
  byteSize: z.number().int().positive(),
})
export type FontFace = z.infer<typeof FontFace>

/** A family in the catalog, its faces lightest first and upright before italic. */
export const FontFamily = z.object({
  family: z.string().min(1),
  source: FontSource,
  /** Google's category, such as sans-serif or display; null for uploads. */
  category: z.string().nullable(),
  faces: FontFace.array().min(1),
})
export type FontFamily = z.infer<typeof FontFamily>

/** Asks to upload a font file; the API answers with the face when the brand already has those bytes. */
export const StartFontUpload = z.object({
  sha256: Sha256,
  byteSize: z.number().int().positive().max(MAX_FONT_BYTES),
  contentType: FontType,
})
export type StartFontUpload = z.infer<typeof StartFontUpload>

export const FontUploadTicket = z.union([
  z.object({ face: FontFace, upload: z.null() }),
  /** PUT the bytes to url with these headers, then record the font with its sha256. */
  z.object({ face: z.null(), upload: z.object({ url: z.url(), headers: z.record(z.string(), z.string()), expiresAt: z.iso.datetime() }) }),
])
export type FontUploadTicket = z.infer<typeof FontUploadTicket>

export const RecordFont = z.object({ sha256: Sha256 })
export type RecordFont = z.infer<typeof RecordFont>

/** A face and short-lived URLs to read its file and its preview, the family's name drawn in it as a PNG. */
export const FontLink = z.object({
  face: FontFace,
  url: z.url(),
  previewUrl: z.url(),
  expiresAt: z.iso.datetime(),
})
export type FontLink = z.infer<typeof FontLink>

/** A colour in a brand kit (#53): its token, the name people see, and its value. */
export const BrandColor = z.object({ token: BrandToken, name: z.string().trim().min(1).max(60), value: Color })
export type BrandColor = z.infer<typeof BrandColor>
/** A font in a brand kit (#53), such as the heading or body family. */
export const BrandFont = z.object({ token: BrandToken, name: z.string().trim().min(1).max(60), family: z.string().trim().min(1).max(100) })
export type BrandFont = z.infer<typeof BrandFont>

/**
 * A brand's kit (#53): its colours and fonts, which designs bind to as `brand:<token>`, its logo (an
 * asset of the brand) and its tone of voice. A token names one colour or font in the kit.
 */
export const BrandKit = z.object({
  colors: BrandColor.array().max(24),
  fonts: BrandFont.array().max(8),
  logoAssetId: RecordId.nullable(),
  voice: z.string().max(2000),
}).superRefine((kit, ctx) => {
  const seen = new Set<string>()
  for (const { token } of [...kit.colors, ...kit.fonts]) {
    if (seen.has(token)) ctx.addIssue({ code: 'custom', message: `the token "${token}" names two things` })
    seen.add(token)
  }
})
export type BrandKit = z.infer<typeof BrandKit>
export const EMPTY_BRAND_KIT: BrandKit = { colors: [], fonts: [], logoAssetId: null, voice: '' }

/** The values a kit gives its tokens, for drawing designs bound to them. */
export const brandVariables = (kit: BrandKit): Variables => Object.fromEntries([
  ...kit.colors.map((c) => [brandRef(c.token), c.value]),
  ...kit.fonts.map((f) => [brandRef(f.token), f.family]),
])

/**
 * Who can start from a template (#54): every brand of the workspace (an agency's own templates), or
 * only the brand it was saved for (a client's).
 */
export const TemplateScope = z.enum(['workspace', 'brand'])
export type TemplateScope = z.infer<typeof TemplateScope>

export const TemplateSummary = z.object({
  id: RecordId,
  name: z.string(),
  scope: TemplateScope,
  /** The brand a brand template belongs to; null for a workspace template. */
  brandId: RecordId.nullable(),
  kind: DesignMeta.shape.kind,
  /** The primary format's size, for the gallery to keep the thumbnail's shape. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.iso.datetime(),
})
export type TemplateSummary = z.infer<typeof TemplateSummary>

/** Saves a design, as the editor holds it now, as a template; the template keeps its own copy. */
export const SaveTemplate = z.object({
  name: z.string().trim().min(1).max(120),
  scope: TemplateScope,
  /** The design, checked with parseDesign. */
  content: z.unknown(),
})
export type SaveTemplate = z.infer<typeof SaveTemplate>

/** A design's or a template's new name. */
export const Rename = z.object({ name: z.string().trim().min(1).max(120) })
export type Rename = z.infer<typeof Rename>

/** Copies a design; named after it with "copy" when no name is given. */
export const DuplicateDesign = z.object({ name: z.string().trim().min(1).max(120).optional() })
export type DuplicateDesign = z.infer<typeof DuplicateDesign>

/** Starts a design of the brand from a template; named after the template when no name is given. */
export const StartFromTemplate = z.object({ name: z.string().trim().min(1).max(120).optional() })
export type StartFromTemplate = z.infer<typeof StartFromTemplate>

// Sign-in (#58). The web app asks the API for WorkOS's sign-in page, hands back the code WorkOS
// returns, and keeps the session token it gets in an httpOnly cookie, sending it as a bearer token.

/** Where to send the person to sign in with WorkOS. */
export const SignInLink = z.object({ url: z.url() })
export type SignInLink = z.infer<typeof SignInLink>

export const CompleteSignIn = z.object({ code: z.string().min(1).max(512) })
export type CompleteSignIn = z.infer<typeof CompleteSignIn>

/** A session: the token to send as `Authorization: Bearer <token>`, and the workspace it is for. */
export const SignedIn = z.object({ token: z.string().min(1), expiresAt: z.number().int(), workspaceId: RecordId })
export type SignedIn = z.infer<typeof SignedIn>

/** Where to send the person to end their WorkOS session too, when they had one. */
export const SignedOut = z.object({ logoutUrl: z.url().nullable() })
export type SignedOut = z.infer<typeof SignedOut>
