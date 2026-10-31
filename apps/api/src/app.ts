// The API's routes. /workspace and every route below /brands need a session, and reads and writes only that
// session's workspace; a brand or design of another workspace is answered as if it didn't exist.
import type { Db } from '@razzlr/db'
import { BrandKit, CompleteSignIn, CreateBrand, CreateDesign, SaveTemplate, StartFromTemplate, RecordAsset, RecordFont, StartFontUpload, StartUpload, UpdateAsset, UpdateWorkspace, type ApiError, type AssetLink, type DesignCover, type DesignThumbnail, type SignedIn, type SignedLink, type SignedOut, type SignInLink, type SyncToken } from '@razzlr/schema'
import type { Storage } from '@razzlr/storage'
import { signSyncToken } from '@razzlr/sync-token'
import { Hono, type MiddlewareHandler } from 'hono'
import type { z } from 'zod'
import { getBrandKit, InvalidKit, saveBrandKit } from './brand-kits.ts'
import { findTemplate, listTemplates, saveTemplate, startFromTemplate, templateThumbnailKey } from './templates.ts'
import { ensureThumbnail, findAsset, InvalidUpload, listAssets, originalKey, recordAsset, SIGNED_URL_SECONDS, startUpload, updateAsset } from './assets.ts'
import { designCover, ensureDesignThumbnail } from './design-thumbnails.ts'
import { fontLink, InvalidFont, listFonts, recordFont, startFontUpload } from './fonts.ts'
import { createBrand, createDesign, findBrand, findDesign, findWorkspace, InvalidContent, listBrands, listDesigns, setWorkspaceKind } from './designs.ts'
import { bearerToken, readSessionToken, type Session, type SessionOf } from './session.ts'
import { completeSignIn, type SignedInPerson, type SignInProvider } from './sign-in.ts'

type Env = { Variables: { session: Session } }

const error = (message: string): ApiError => ({ error: message })

/** Sign-in with WorkOS, when it is set up: the provider, and the secret session tokens are signed with. */
export interface SignInSettings {
  provider: SignInProvider
  secret: string
}

export function createApp({ db, storage, sessionOf, syncSecret, signIn = null }: { db: Db; storage: Storage; sessionOf: SessionOf; syncSecret: string; signIn?: SignInSettings | null }) {
  const app = new Hono<Env>()

  app.get('/health', (c) => c.json({ ok: true }))

  // Sign-in (#58). The web app's /login asks for the link, its /callback hands back the code.
  app.get('/auth/sign-in-url', (c) => {
    if (!signIn) return c.json(error('Sign-in is not set up'), 404)
    const state = c.req.query('state') ?? ''
    if (!/^[\w-]{16,128}$/.test(state)) return c.json(error('state: 16–128 letters, digits, _ and -'), 400)
    return c.json({ url: signIn.provider.signInUrl(state) } satisfies SignInLink)
  })

  app.post('/auth/callback', async (c) => {
    if (!signIn) return c.json(error('Sign-in is not set up'), 404)
    const input = await body(c.req.raw, CompleteSignIn)
    if (input instanceof Response) return input
    let person: SignedInPerson
    try {
      person = await signIn.provider.authenticate(input.code)
    } catch {
      return c.json(error('That sign-in did not work; try again'), 400)
    }
    return c.json(await completeSignIn(db, signIn.provider, signIn.secret, person) satisfies SignedIn)
  })

  // Signing out forgets the token in the web app; this says where to end the WorkOS session too.
  app.post('/auth/sign-out', (c) => {
    const token = bearerToken(c.req.raw)
    const payload = signIn && token ? readSessionToken(signIn.secret, token) : null
    const logoutUrl = payload?.workosSessionId ? signIn?.provider.signOutUrl(payload.workosSessionId) ?? null : null
    return c.json({ logoutUrl } satisfies SignedOut)
  })

  const requireSession: MiddlewareHandler<Env> = async (c, next) => {
    const session = await sessionOf(c.req.raw)
    if (!session) return c.json(error('Sign in first'), 401)
    c.set('session', session)
    await next()
  }
  app.use('/workspace', requireSession)
  app.use('/brands', requireSession)
  app.use('/brands/*', requireSession)

  /** The body parsed with `schema`, or a 400 response saying what's wrong with it. */
  async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | Response> {
    let json: unknown
    try {
      json = await request.json()
    } catch {
      return Response.json(error('The body is not JSON'), { status: 400 })
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) return Response.json(error(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')), { status: 400 })
    return parsed.data
  }

  app.get('/workspace', async (c) => {
    const workspace = await findWorkspace(db, c.var.session.workspaceId)
    return workspace ? c.json(workspace) : c.json(error('No such workspace'), 404)
  })

  // Onboarding asks who Razzlr is for; the answer only changes defaults and words (ADR-0011).
  app.patch('/workspace', async (c) => {
    const input = await body(c.req.raw, UpdateWorkspace)
    if (input instanceof Response) return input
    const workspace = await setWorkspaceKind(db, c.var.session.workspaceId, input.kind)
    return workspace ? c.json(workspace) : c.json(error('No such workspace'), 404)
  })

  app.get('/brands', async (c) => c.json(await listBrands(db, c.var.session.workspaceId)))

  app.post('/brands', async (c) => {
    const input = await body(c.req.raw, CreateBrand)
    if (input instanceof Response) return input
    return c.json(await createBrand(db, c.var.session.workspaceId, input.name), 201)
  })

  app.get('/brands/:brandId/designs', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    return c.json(await listDesigns(db, workspaceId, brand.id))
  })

  app.post('/brands/:brandId/designs', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, CreateDesign)
    if (input instanceof Response) return input
    try {
      return c.json(await createDesign(db, workspaceId, brand.id, input.name, input.content), 201)
    } catch (e) {
      if (e instanceof InvalidContent) return c.json(error(`The design is not valid: ${e.message}`), 400)
      throw e
    }
  })

  app.get('/brands/:brandId/designs/:designId', async (c) => {
    const design = await findDesign(db, c.var.session.workspaceId, c.req.param('brandId'), c.req.param('designId'))
    return design ? c.json(design) : c.json(error('No such design'), 404)
  })

  // A token for the sync server, only after the same workspace and brand checks as opening the design.
  // The primary format's size alone, read without drawing, for the home to lay out its bento (#84).
  app.get('/brands/:brandId/designs/:designId/cover', async (c) => {
    const design = await findDesign(db, c.var.session.workspaceId, c.req.param('brandId'), c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const cover = await designCover(db, design)
    return cover ? c.json(cover satisfies DesignCover) : c.json(error('This design has nothing to show yet'), 404)
  })

  app.get('/brands/:brandId/designs/:designId/thumbnail', async (c) => {
    const { workspaceId } = c.var.session
    const design = await findDesign(db, workspaceId, c.req.param('brandId'), c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const cover = await ensureDesignThumbnail(db, storage, workspaceId, design)
    if (!cover) return c.json(error('This design has nothing to show yet'), 404)
    const url = await storage.signedGet(cover.key, SIGNED_URL_SECONDS)
    return c.json({ url, width: cover.width, height: cover.height, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() } satisfies DesignThumbnail)
  })

  app.post('/brands/:brandId/designs/:designId/sync-token', async (c) => {
    const { workspaceId, userId } = c.var.session
    const design = await findDesign(db, workspaceId, c.req.param('brandId'), c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const { token, expiresAt } = signSyncToken(syncSecret, { designId: design.id, workspaceId, userId })
    return c.json({ token, expiresAt: new Date(expiresAt).toISOString() } satisfies SyncToken)
  })

  // Images: uploads go straight to storage through a signed URL, then are recorded here (#35).
  // The asset library (#52) finds them by name and tag: ?q=summer sale.
  app.get('/brands/:brandId/assets', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const query = c.req.query('q') ?? ''
    if (query.length > 200) return c.json(error('A search is at most 200 characters'), 400)
    return c.json(await listAssets(db, workspaceId, brand.id, query))
  })

  app.post('/brands/:brandId/assets/uploads', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, StartUpload)
    if (input instanceof Response) return input
    return c.json(await startUpload(db, storage, workspaceId, brand.id, input))
  })

  app.post('/brands/:brandId/assets', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, RecordAsset)
    if (input instanceof Response) return input
    try {
      return c.json(await recordAsset(db, storage, workspaceId, brand.id, input.sha256, input.name), 201)
    } catch (e) {
      if (e instanceof InvalidUpload) return c.json(error(e.message), 400)
      throw e
    }
  })

  app.get('/brands/:brandId/assets/:assetId', async (c) => {
    const { workspaceId } = c.var.session
    const asset = await findAsset(db, workspaceId, c.req.param('brandId'), { id: c.req.param('assetId') })
    if (!asset) return c.json(error('No such asset'), 404)
    const url = await storage.signedGet(originalKey(workspaceId, asset.sha256), SIGNED_URL_SECONDS)
    return c.json({ asset, url, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() } satisfies AssetLink)
  })

  app.patch('/brands/:brandId/assets/:assetId', async (c) => {
    const { workspaceId } = c.var.session
    const input = await body(c.req.raw, UpdateAsset)
    if (input instanceof Response) return input
    const asset = await updateAsset(db, workspaceId, c.req.param('brandId'), c.req.param('assetId'), input)
    if (!asset) return c.json(error('No such asset'), 404)
    return c.json(asset)
  })

  app.get('/brands/:brandId/assets/:assetId/thumbnail', async (c) => {
    const { workspaceId } = c.var.session
    const asset = await findAsset(db, workspaceId, c.req.param('brandId'), { id: c.req.param('assetId') })
    if (!asset) return c.json(error('No such asset'), 404)
    const url = await storage.signedGet(await ensureThumbnail(storage, workspaceId, asset), SIGNED_URL_SECONDS)
    return c.json({ url, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() } satisfies SignedLink)
  })

  // Templates (#54): the workspace's and the brand's, a design saved to start others from.
  app.get('/brands/:brandId/templates', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    return c.json(await listTemplates(db, workspaceId, brand.id))
  })

  app.post('/brands/:brandId/templates', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, SaveTemplate)
    if (input instanceof Response) return input
    try {
      return c.json(await saveTemplate(db, storage, workspaceId, brand.id, input), 201)
    } catch (e) {
      if (e instanceof InvalidContent) return c.json(error(`The design is not valid: ${e.message}`), 400)
      throw e
    }
  })

  app.get('/brands/:brandId/templates/:templateId/thumbnail', async (c) => {
    const { workspaceId } = c.var.session
    const template = await findTemplate(db, workspaceId, c.req.param('brandId'), c.req.param('templateId'))
    if (!template) return c.json(error('No such template'), 404)
    const url = await storage.signedGet(templateThumbnailKey(workspaceId, template.id), SIGNED_URL_SECONDS)
    return c.json({ url, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString() } satisfies SignedLink)
  })

  app.post('/brands/:brandId/templates/:templateId/designs', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, StartFromTemplate)
    if (input instanceof Response) return input
    const design = await startFromTemplate(db, workspaceId, brand.id, c.req.param('templateId'), input.name)
    return design ? c.json(design, 201) : c.json(error('No such template'), 404)
  })

  // Brand kits (#53): the colours and fonts designs bind to, the logo and the tone of voice.
  app.get('/brands/:brandId/kit', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    return c.json(await getBrandKit(db, workspaceId, brand.id))
  })

  app.put('/brands/:brandId/kit', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, BrandKit)
    if (input instanceof Response) return input
    try {
      return c.json(await saveBrandKit(db, workspaceId, brand.id, input))
    } catch (e) {
      if (e instanceof InvalidKit) return c.json(error(e.message), 400)
      throw e
    }
  })

  // Fonts (#50): Google Fonts copied into our storage and the brand's uploads, read back from there.
  app.get('/brands/:brandId/fonts', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    return c.json(await listFonts(db, workspaceId, brand.id))
  })

  app.post('/brands/:brandId/fonts/uploads', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, StartFontUpload)
    if (input instanceof Response) return input
    return c.json(await startFontUpload(db, storage, workspaceId, brand.id, input))
  })

  app.post('/brands/:brandId/fonts', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const input = await body(c.req.raw, RecordFont)
    if (input instanceof Response) return input
    try {
      return c.json(await recordFont(db, storage, workspaceId, brand.id, input.sha256), 201)
    } catch (e) {
      if (e instanceof InvalidFont) return c.json(error(e.message), 400)
      throw e
    }
  })

  app.get('/brands/:brandId/fonts/faces/:faceId', async (c) => {
    const { workspaceId } = c.var.session
    const brand = await findBrand(db, workspaceId, c.req.param('brandId'))
    if (!brand) return c.json(error('No such brand'), 404)
    const link = await fontLink(db, storage, workspaceId, brand.id, c.req.param('faceId'))
    return link ? c.json(link) : c.json(error('No such font'), 404)
  })

  app.onError((e, c) => {
    console.error(e)
    return c.json(error('Something went wrong on our side'), 500)
  })

  return app
}
