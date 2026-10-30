import { z } from 'zod'
import type { Ad } from './ad.ts'
import { describeAd } from './brief.ts'
import { gemini, MODELS } from './gemini.ts'

const Reading = z.object({ texts: z.string().array() })

/**
 * Reads every text off a finished draft exactly as drawn, the same way for both paths. On hybrid
 * drafts, whose texts we drew ourselves, it measures the reader's own error rate.
 */
export async function readBack(ad: Ad, png: Uint8Array, label: string) {
  return await gemini({
    adId: ad.id, step: `read-back:${label}`, model: MODELS.text, json: Reading,
    parts: [
      {
        text: [
          `Transcribe every piece of text visible in this ad image, one entry per block of text, in reading order.`,
          `Copy exactly what is drawn, letter by letter and mark by mark: never correct spelling, never complete or normalise words, never translate. Write � for any glyph that is malformed or can't be read.`,
          `Include small print, text on products, signs or packaging, and any garbled or partial lettering.`,
        ].join('\n'),
      },
      { image: png },
    ],
  })
}

const Verdict = z.object({ better: z.enum(['first', 'second', 'tie']), reason: z.string() })

/**
 * Which of two drafts of the same ad looks more like a finished, professional ad, judged on the
 * look only: spelling is measured on its own. Asked in both orders, so a judge that favours a
 * position cancels out; a split counts as a tie.
 */
export async function judgeLook(ad: Ad, flat: Uint8Array, hybrid: Uint8Array, label: string): Promise<{ winner: 'flat' | 'hybrid' | 'tie'; reasons: string[]; seconds: number; costUsd: number }> {
  const ask = (first: Uint8Array, second: Uint8Array, order: string) => gemini({
    adId: ad.id, step: `look:${label}:${order}`, model: MODELS.text, json: Verdict,
    parts: [
      {
        text: [
          `You are an agency art director. Two drafts of the same ad follow. Which looks more like a finished, professional ad a client would approve: composition, how text and picture work together, hierarchy, legibility, polish and fit with the brand?`,
          `Ignore spelling and whether every text is present; that is measured separately. Answer "tie" only if you truly can't choose.`,
          describeAd(ad),
        ].join('\n'),
      },
      { image: first },
      { image: second },
    ],
  })
  const a = await ask(flat, hybrid, 'flat-first')
  const b = await ask(hybrid, flat, 'hybrid-first')
  type Side = 'flat' | 'hybrid' | 'tie'
  const vote = (v: 'first' | 'second' | 'tie', firstIs: 'flat' | 'hybrid'): Side => v === 'tie' ? 'tie' : (v === 'first') === (firstIs === 'flat') ? 'flat' : 'hybrid'
  const votes: Side[] = [vote(a.value.better, 'flat'), vote(b.value.better, 'hybrid')]
  const winner = votes[0] === votes[1] ? votes[0] ?? 'tie' : votes.includes('tie') ? votes.find((v) => v !== 'tie') ?? 'tie' : 'tie'
  return { winner, reasons: [a.value.reason, b.value.reason], seconds: a.seconds + b.seconds, costUsd: a.costUsd + b.costUsd }
}

const Fidelity = z.object({ score: z.number().int().min(1).max(5), differences: z.string() })

/** How closely the flat path's editable design still looks like the draft the user chose, 1 to 5. */
export async function judgeFidelity(ad: Ad, draft: Uint8Array, editable: Uint8Array, label: string) {
  return await gemini({
    adId: ad.id, step: `fidelity:${label}`, model: MODELS.text, json: Fidelity,
    parts: [
      {
        text: [
          `The first image is an ad draft a user chose. The second was rebuilt from it as editable layers. How closely does the second still look like the first?`,
          `5: the same ad, differences only on close inspection. 4: small visible differences in lettering or spacing. 3: clearly different lettering or layout, same ad. 2: important parts lost or changed. 1: a different ad.`,
          `List the main differences.`,
        ].join('\n'),
      },
      { image: draft },
      { image: editable },
    ],
  })
}
