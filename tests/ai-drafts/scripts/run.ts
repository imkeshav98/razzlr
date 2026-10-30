// Runs the AI draft test (#24): every ad of the eval set through the flat path and the hybrid
// path, on each image model, then reads, checks and judges the drafts. Calls are cached in
// runs/cache, so a rerun only pays for what changed.
//   GEMINI_API_KEY=… pnpm run-test [ad-id …]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAds, type Ad } from '../src/ad.ts'
import { contextOf, type Context } from '../src/context.ts'
import { contrast, draw, loadKit, withoutText } from '../src/draw.ts'
import { brandFamilies } from '../src/fonts.ts'
import { flatDraft, makeEditable, readDraft } from '../src/flat.ts'
import { MODELS, RUNS_DIR, spentUsd } from '../src/gemini.ts'
import { hybridDraft } from '../src/hybrid.ts'
import { judgeFidelity, judgeLook, readBack } from '../src/judge.ts'
import type { Layout } from '../src/layout.ts'
import { matchTexts } from '../src/match.ts'
import type { DesignInput } from '@razzlr/schema'

const only = process.argv.slice(2)
const ads = loadAds().filter((a) => only.length === 0 || only.includes(a.id))
const models = (process.env.AI_DRAFTS_MODELS?.split(',') ?? [MODELS.imagePro, MODELS.imageFlash])
const concurrency = Number(process.env.AI_DRAFTS_CONCURRENCY ?? 3)

const kit = await loadKit()
const families = brandFamilies(kit.ck, kit.fonts)

/** Contrast of each text layer against the design drawn without its texts. */
function contrastOf(ctx: Context, design: DesignInput, layout: Layout, images: Record<string, Uint8Array>) {
  const back = draw(ctx.kit, withoutText(design), images)
  return layout.layers.flatMap((l) => l.type === 'text'
    ? [{ textIndex: l.textIndex, ...contrast(back, { x: l.box.x, y: l.box.y, width: l.box.w, height: l.box.h }, l.color) }]
    : [])
}

async function runOne(ad: Ad, model: string) {
  const ctx = contextOf(ad, kit, families)
  const dir = join(RUNS_DIR, ad.id, model)
  mkdirSync(dir, { recursive: true })
  const intended = ad.texts.map((t) => t.text)
  const short = model === MODELS.imagePro ? 'pro' : 'flash'

  // Flat: the draft, the user's view of it, then the layering text steps.
  const flat = await flatDraft(ctx, model)
  writeFileSync(join(dir, 'flat.png'), flat.png)
  const flatRead = await readBack(ad, flat.png, `flat:${short}`)
  const read = await readDraft(ctx, flat.png, short)
  const editable = await makeEditable(ctx, flat.png, read.value.blocks, short)
  writeFileSync(join(dir, 'editable.png'), editable.png)
  const fidelity = await judgeFidelity(ad, flat.png, editable.png, short)

  // Hybrid: the plan, the picture, the fitted layout drawn by our renderer.
  const hybrid = await hybridDraft(ctx, model)
  writeFileSync(join(dir, 'hybrid.png'), hybrid.png)
  writeFileSync(join(dir, 'picture.png'), hybrid.picture)
  const hybridRead = await readBack(ad, hybrid.png, `hybrid:${short}`)
  const pictureRead = await readBack(ad, hybrid.picture, `picture:${short}`)
  const look = await judgeLook(ad, flat.png, hybrid.png, short)

  const images: Record<string, Uint8Array> = { picture: hybrid.picture }
  if (ctx.assets.logo) images.logo = ctx.assets.logo
  const result = {
    adId: ad.id, language: ad.language, kind: ad.kind, format: ad.format, model, texts: intended,
    flat: {
      draftSeconds: flat.seconds, draftCostUsd: flat.costUsd,
      asDrawn: matchTexts(intended, flatRead.value.texts), readBack: flatRead.value.texts,
      blocks: read.value.blocks,
      editable: {
        live: editable.live, strayLive: editable.strayLive, fits: editable.fits,
        // The brief's measure: every intended text a live layer, no other text left as one or in a cut-out.
        cutouts: editable.layout.layers.filter((l) => l.type === 'cutout').map((l) => l.name),
        layeringSeconds: read.seconds + editable.seconds, layeringCostUsd: read.costUsd + editable.costUsd,
      },
      fidelity: fidelity.value,
    },
    hybrid: {
      seconds: hybrid.seconds, costUsd: hybrid.costUsd,
      missing: hybrid.missing, invented: hybrid.invented, fits: hybrid.fits,
      contrast: contrastOf(ctx, hybrid.design, hybrid.layout, images),
      readBack: hybridRead.value.texts, asDrawn: matchTexts(intended, hybridRead.value.texts),
      pictureText: pictureRead.value.texts,
      plan: hybrid.plan, layout: hybrid.layout,
    },
    look,
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2))
  return result
}

const jobs = ads.flatMap((ad) => models.map((model) => ({ ad, model })))
let next = 0
const failures: string[] = []
async function worker() {
  for (let job = jobs[next++]; job; job = jobs[next++]) {
    const name = `${job.ad.id} on ${job.model}`
    try {
      const r = await runOne(job.ad, job.model)
      const flatOk = r.flat.asDrawn.found.every(Boolean) && r.flat.asDrawn.stray.length === 0
      console.log(`${name}: flat as drawn ${flatOk ? 'right' : 'wrong'}, hybrid missing ${r.hybrid.missing.length}, look → ${r.look.winner}; spent $${spentUsd().toFixed(2)}`)
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`)
      console.error(`${name} failed: ${(error as Error).message}`)
      if ((error as Error).message.includes('budget')) next = jobs.length
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
console.log(`\n${jobs.length - failures.length}/${jobs.length} runs done; $${spentUsd().toFixed(2)} spent in all`)
if (failures.length > 0) {
  console.log(failures.join('\n'))
  process.exitCode = 1
}
