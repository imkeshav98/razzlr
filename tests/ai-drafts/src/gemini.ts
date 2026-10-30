import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const RUNS_DIR = join(import.meta.dirname, '..', 'runs')
const CACHE_DIR = join(RUNS_DIR, 'cache')
const LEDGER = join(RUNS_DIR, 'ledger.jsonl')

/** The models of the test; each can be swapped with an environment variable. */
export const MODELS = {
  /** Plans, reads text back, matches fonts and judges. */
  text: process.env.AI_DRAFTS_TEXT_MODEL ?? 'gemini-3.1-pro-preview',
  /** Nano Banana Pro: the strongest Gemini model at lettering. */
  imagePro: process.env.AI_DRAFTS_IMAGE_PRO ?? 'gemini-3-pro-image',
  /** Nano Banana 2: the cheaper one a product would run on every round. */
  imageFlash: process.env.AI_DRAFTS_IMAGE_FLASH ?? 'gemini-3.1-flash-image',
} as const

/**
 * List prices on ai.google.dev/gemini-api/docs/pricing, read 2026-10-30 (standard tier).
 * Text models are per million tokens; image models per 2K output image plus their text tokens.
 */
const PRICES: Record<string, { input: number; output: number; image?: number }> = {
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-3-pro-image': { input: 2, output: 12, image: 0.134 },
  'gemini-3.1-flash-image': { input: 0.5, output: 3, image: 0.101 },
}

const BUDGET_USD = Number(process.env.AI_DRAFTS_BUDGET_USD ?? 50)

export interface Part { text?: string; image?: Uint8Array; mimeType?: string }

export interface Call {
  /** For the ledger: which ad and which step this call belongs to. */
  adId: string
  step: string
  model: string
  parts: Part[]
  /** A JSON answer checked against this schema, or an image. */
  json?: z.ZodType
  image?: { aspectRatio: string; size: '1K' | '2K' }
  /** Several samples of the same request get their own cache entries. */
  sample?: number
}

export interface Answer<T> { value: T; seconds: number; costUsd: number; cached: boolean }

interface Entry { adId: string; step: string; model: string; seconds: number; costUsd: number; at: string }

export function ledger(): Entry[] {
  if (!existsSync(LEDGER)) return []
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Entry)
}
export const spentUsd = () => ledger().reduce((sum, e) => sum + e.costUsd, 0)

const toPart = (p: Part) => p.image
  ? { inlineData: { mimeType: p.mimeType ?? 'image/png', data: Buffer.from(p.image).toString('base64') } }
  : { text: p.text ?? '' }

function bodyOf(call: Call) {
  const generationConfig = call.image
    ? { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: call.image.aspectRatio, imageSize: call.image.size } }
    : { responseMimeType: 'application/json', ...(call.json ? { responseJsonSchema: z.toJSONSchema(call.json, { target: 'draft-7' }) } : {}) }
  return { contents: [{ role: 'user', parts: call.parts.map(toPart) }], generationConfig }
}

interface Usage { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
interface Response {
  candidates?: { content?: { parts?: { text?: string; inlineData?: { data: string; mimeType: string } }[] }; finishReason?: string }[]
  usageMetadata?: Usage
  promptFeedback?: unknown
}

function costOf(model: string, usage: Usage | undefined, images: number): number {
  const price = PRICES[model]
  if (!price) throw new Error(`no price for ${model}: add it to PRICES before running`)
  const input = (usage?.promptTokenCount ?? 0) * price.input / 1e6
  // Image output tokens are billed through the per-image price, so only thinking counts as text here.
  const textOut = images > 0 ? usage?.thoughtsTokenCount ?? 0 : (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)
  return input + textOut * price.output / 1e6 + images * (price.image ?? 0)
}

/**
 * One Gemini call, cached on disk by its request so a rerun costs nothing, recorded in the
 * ledger with its seconds and cost, and refused once the run has spent its budget.
 */
export async function gemini<T>(call: Call & { json: z.ZodType<T> }): Promise<Answer<T>>
export async function gemini(call: Call & { image: NonNullable<Call['image']> }): Promise<Answer<Uint8Array>>
export async function gemini(call: Call): Promise<Answer<unknown>> {
  const body = bodyOf(call)
  const key = createHash('sha256').update(JSON.stringify({ model: call.model, body, sample: call.sample ?? 0 })).digest('hex')
  const cached = join(CACHE_DIR, `${key}.json`)
  mkdirSync(CACHE_DIR, { recursive: true })

  let response: Response
  let seconds = 0
  let costUsd = 0
  const hit = existsSync(cached)
  if (hit) {
    ({ response, seconds, costUsd } = JSON.parse(readFileSync(cached, 'utf8')) as { response: Response; seconds: number; costUsd: number })
  } else {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
    if (spentUsd() >= BUDGET_USD) throw new Error(`budget of $${BUDGET_USD} spent; raise AI_DRAFTS_BUDGET_USD to go on`)
    const start = performance.now()
    response = await post(call.model, body, apiKey)
    seconds = (performance.now() - start) / 1000
    const images = (response.candidates?.[0]?.content?.parts ?? []).filter((p) => p.inlineData).length
    costUsd = costOf(call.model, response.usageMetadata, images)
    writeFileSync(cached, JSON.stringify({ request: { model: call.model, step: call.step, adId: call.adId }, response, seconds, costUsd }))
    const entry: Entry = { adId: call.adId, step: call.step, model: call.model, seconds, costUsd, at: new Date().toISOString() }
    appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`)
  }

  const parts = response.candidates?.[0]?.content?.parts ?? []
  if (call.image) {
    const data = parts.find((p) => p.inlineData)?.inlineData?.data
    if (!data) throw new Error(`${call.model} returned no image for ${call.adId}/${call.step}: ${JSON.stringify(response.candidates?.[0]?.finishReason ?? response.promptFeedback)}`)
    return { value: new Uint8Array(Buffer.from(data, 'base64')), seconds, costUsd, cached: hit }
  }
  const text = parts.filter((p) => p.text).map((p) => p.text).join('')
  const parsed = (call.json ?? z.unknown()).safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error(`${call.model} answered ${call.adId}/${call.step} off-schema: ${z.prettifyError(parsed.error)}`)
  return { value: parsed.data, seconds, costUsd, cached: hit }
}

async function post(model: string, body: unknown, apiKey: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) })
    if (res.ok) return await res.json() as Response
    const retry = res.status === 429 || res.status >= 500
    if (!retry || attempt >= 4) throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 500)}`)
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
  }
}

/** The aspect ratios Gemini's image models paint; a format gets the nearest and is cropped to fit. */
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
export function nearestRatio(width: number, height: number): string {
  const target = Math.log(width / height)
  const value = (r: string) => { const [w, h] = r.split(':').map(Number); return Math.log((w ?? 1) / (h ?? 1)) }
  return RATIOS.reduce((best, r) => Math.abs(value(r) - target) < Math.abs(value(best) - target) ? r : best)
}
