// The API's routes. Every route below /clients needs a session, and reads and writes only that
// session's org; a client or design of another org is answered as if it didn't exist.
import type { Db } from '@razzlr/db'
import { CreateClient, CreateDesign, type ApiError, type SyncToken } from '@razzlr/schema'
import { signSyncToken } from '@razzlr/sync-token'
import { Hono, type MiddlewareHandler } from 'hono'
import type { z } from 'zod'
import { createClient, createDesign, findClient, findDesign, InvalidContent, listClients, listDesigns } from './designs.ts'
import type { Session, SessionOf } from './session.ts'

type Env = { Variables: { session: Session } }

const error = (message: string): ApiError => ({ error: message })

export function createApp({ db, sessionOf, syncSecret }: { db: Db; sessionOf: SessionOf; syncSecret: string }) {
  const app = new Hono<Env>()

  app.get('/health', (c) => c.json({ ok: true }))

  const requireSession: MiddlewareHandler<Env> = async (c, next) => {
    const session = await sessionOf(c.req.raw)
    if (!session) return c.json(error('Sign in first'), 401)
    c.set('session', session)
    await next()
  }
  app.use('/clients', requireSession)
  app.use('/clients/*', requireSession)

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

  app.get('/clients', async (c) => c.json(await listClients(db, c.var.session.orgId)))

  app.post('/clients', async (c) => {
    const input = await body(c.req.raw, CreateClient)
    if (input instanceof Response) return input
    return c.json(await createClient(db, c.var.session.orgId, input.name), 201)
  })

  app.get('/clients/:clientId/designs', async (c) => {
    const { orgId } = c.var.session
    const client = await findClient(db, orgId, c.req.param('clientId'))
    if (!client) return c.json(error('No such client'), 404)
    return c.json(await listDesigns(db, orgId, client.id))
  })

  app.post('/clients/:clientId/designs', async (c) => {
    const { orgId } = c.var.session
    const client = await findClient(db, orgId, c.req.param('clientId'))
    if (!client) return c.json(error('No such client'), 404)
    const input = await body(c.req.raw, CreateDesign)
    if (input instanceof Response) return input
    try {
      return c.json(await createDesign(db, orgId, client.id, input.name, input.content), 201)
    } catch (e) {
      if (e instanceof InvalidContent) return c.json(error(`The design is not valid: ${e.message}`), 400)
      throw e
    }
  })

  app.get('/clients/:clientId/designs/:designId', async (c) => {
    const design = await findDesign(db, c.var.session.orgId, c.req.param('clientId'), c.req.param('designId'))
    return design ? c.json(design) : c.json(error('No such design'), 404)
  })

  // A token for the sync server, only after the same org and client checks as opening the design.
  app.post('/clients/:clientId/designs/:designId/sync-token', async (c) => {
    const { orgId, userId } = c.var.session
    const design = await findDesign(db, orgId, c.req.param('clientId'), c.req.param('designId'))
    if (!design) return c.json(error('No such design'), 404)
    const { token, expiresAt } = signSyncToken(syncSecret, { designId: design.id, orgId, userId })
    return c.json({ token, expiresAt: new Date(expiresAt).toISOString() } satisfies SyncToken)
  })

  app.onError((e, c) => {
    console.error(e)
    return c.json(error('Something went wrong on our side'), 500)
  })

  return app
}
