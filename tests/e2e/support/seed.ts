import { HocuspocusProvider } from '@hocuspocus/provider'
import { loadDesign } from '@razzlr/doc'
import { parseDesign, type DesignInput } from '@razzlr/schema'

export const SYNC_URL = process.env.SYNC_URL ?? 'ws://localhost:1234'

/** A design for the live editing checks: shapes to drag, and English and Arabic text to type into. */
export const liveDesign = (designId: string): DesignInput => ({
  meta: { schemaVersion: 1, designId, name: 'Live editing', kind: 'single', primaryFormatId: 'sq' },
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

/** Writes a design to the sync server, as a new document, and waits until the server has it. */
export async function seed(design: DesignInput): Promise<void> {
  const parsed = parseDesign(design)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const document = loadDesign(parsed.design)
  const provider = new HocuspocusProvider({ url: SYNC_URL, name: parsed.design.meta.designId, document })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no sync server at ${SYNC_URL}; run docker compose up -d --wait`)), 10_000)
    const done = () => {
      if (provider.unsyncedChanges > 0) return
      clearTimeout(timer)
      resolve()
    }
    provider.on('synced', done)
    provider.on('unsyncedChanges', done)
  })
  provider.destroy()
}
