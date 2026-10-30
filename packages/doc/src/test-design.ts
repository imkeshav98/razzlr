import type { DesignInput } from '@razzlr/schema'

/** A small design for tests: one page, a square and a banner, a box and a headline. */
export const testDesign = (): DesignInput => ({
  meta: { schemaVersion: 2, designId: 'd1', name: 'Test', kind: 'single', primaryFormatId: 'sq' },
  formats: {
    sq: { name: 'Square', width: 1080, height: 1080, order: 'a0' },
    banner: { name: 'Banner', width: 320, height: 50, order: 'a1' },
  },
  pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
  nodes: {
    box: {
      type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box',
      props: { x: 100, y: 100, width: 200, height: 100, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF5A36FF' }] },
    },
    headline: {
      type: 'text', parentId: 'p1', index: 'a1', name: 'Headline', role: 'headline',
      props: {
        x: 60, y: 600, width: 960, height: 100, text: 'Summer sale',
        style: { fontFamily: 'Noto Sans', fontSize: 84, color: '#111111FF' },
        runs: [{ start: 7, end: 11, style: { fontWeight: 800 } }],
      },
    },
  },
  overrides: { 'format:banner': { headline: { text: 'Sale', x: 4, runs: [] } } },
})
