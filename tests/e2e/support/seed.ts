import { DesignSummary, type DesignInput } from '@razzlr/schema'

export const API_URL = process.env.API_URL ?? 'http://localhost:8787'
/** A brand of the development workspace the API seeds (apps/api/src/session.ts). */
export const DEV_BRAND = 'dev-brand-coffee'

/** A design for the live editing checks: shapes to drag, and English and Arabic text to type into. */
export const liveDesign = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'replaced-by-the-api', name: 'Live editing', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' } },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFF8F0FF' }] } },
  nodes: {
    box: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box',
      props: { x: 80, y: 80, width: 300, height: 200, shape: { kind: 'rect', cornerRadius: 24 }, fills: [{ type: 'solid', color: '#FF5A36FF' }] },
    },
    dot: {
      type: 'graphic', parentId: 'p1', index: 'a1', name: 'Dot',
      props: { x: 700, y: 120, width: 240, height: 240, shape: { kind: 'ellipse' }, fills: [{ type: 'solid', color: '#2F6BFFFF' }] },
    },
    headline: {
      type: 'text', parentId: 'p1', index: 'a2', name: 'Headline', role: 'headline',
      props: { x: 80, y: 480, width: 920, height: 120, text: 'Summer sale', style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 800, color: '#111111FF' } },
    },
    arabic: {
      type: 'text', parentId: 'p1', index: 'a3', name: 'Arabic', role: 'body',
      props: { x: 80, y: 680, width: 920, height: 100, text: 'تخفيضات الصيف', style: { fontFamily: 'Noto Naskh Arabic', fontSize: 64, color: '#1B5E20FF' } },
    },
  },
  overrides: {},
})

/** Creates a design for the development brand through the API, starting from `content`, and returns its id. */
export async function seed(content: DesignInput, name = content.meta.name): Promise<string> {
  const response = await fetch(`${API_URL}/brands/${DEV_BRAND}/designs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, content }),
  }).catch(() => {
    throw new Error(`no API at ${API_URL}; run docker compose up -d --wait`)
  })
  const json: unknown = await response.json()
  if (!response.ok) throw new Error(`the API refused the design: ${JSON.stringify(json)}`)
  return DesignSummary.parse(json).id
}
