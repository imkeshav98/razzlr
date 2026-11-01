import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { describe, expect, it } from 'vitest'
import { crc32, exportDesign, fileName, readZip, zip } from './index.ts'

const ck = await loadCanvasKit()
const bytes = { fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }

const design = {
  meta: { schemaVersion: 2, designId: 'd', name: 'Summer: sale', kind: 'single', primaryFormatId: 'sq' },
  formats: { sq: { name: 'Square', width: 120, height: 120, order: 'a0' }, story: { name: 'Story 9:16', width: 90, height: 160, order: 'a1' } },
  pages: {
    p1: { name: 'Hero', order: 'a0', fills: [{ type: 'solid', color: '#FF000080' }] },
    p2: { name: 'Hero', order: 'a1', fills: [] },
  },
  nodes: {
    box: { type: 'graphic', parentId: 'p1', index: 'a0', name: 'Box', props: { x: 10, y: 10, width: 40, height: 40, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#0000FFFF' }] } },
    title: { type: 'text', parentId: 'p2', index: 'a0', name: 'Title', props: { x: 4, y: 4, width: 80, height: 40, text: 'Sale', style: { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' } } },
  },
  overrides: {},
}

const pixelAt = (encoded: Uint8Array, x: number, y: number) => {
  const image = ck.MakeImageFromEncoded(encoded)
  if (!image) throw new Error('could not decode')
  const px = image.readPixels(x, y, { width: 1, height: 1, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB })
  const size = [image.width(), image.height()]
  image.delete()
  return { px: [...(px as Uint8Array)], size }
}

describe('export', () => {
  it('one page in one format is one PNG, named from the template, with its transparency', () => {
    const file = exportDesign(ck, design, { pageIds: ['p1'], formatIds: ['sq'], type: 'png' }, bytes)
    expect(file.name).toBe('Summer- sale - Hero - Square.png')
    expect(file.type).toBe('image/png')
    const { px, size } = pixelAt(file.bytes, 100, 100)
    expect(size).toEqual([120, 120])
    expect(px[0]).toBe(255)
    expect(Math.abs((px[3] ?? 0) - 128)).toBeLessThanOrEqual(1)
  })

  it('a JPG is drawn over white, at the quality asked for', () => {
    const low = exportDesign(ck, design, { pageIds: ['p1'], formatIds: ['sq'], type: 'jpg', quality: 20 }, bytes)
    const high = exportDesign(ck, design, { pageIds: ['p1'], formatIds: ['sq'], type: 'jpg', quality: 95 }, bytes)
    expect(high.name.endsWith('.jpg')).toBe(true)
    expect(high.type).toBe('image/jpeg')
    expect(low.bytes.length).toBeLessThan(high.bytes.length)
    // Half red over white is pink.
    const [r = 0, g = 0, b = 0] = pixelAt(high.bytes, 100, 100).px
    expect(r).toBeGreaterThan(245)
    expect(Math.abs(g - 127)).toBeLessThanOrEqual(4)
    expect(Math.abs(b - 127)).toBeLessThanOrEqual(4)
  })

  it('several files are one zip with a folder per format, pages with the same name numbered', () => {
    const seen: number[] = []
    const file = exportDesign(ck, design, { pageIds: ['p1', 'p2'], formatIds: ['sq', 'story'], type: 'png', name: '{page}' }, bytes, undefined, (done) => seen.push(done))
    expect(file).toMatchObject({ name: 'Summer- sale.zip', type: 'application/zip' })
    expect(seen).toEqual([1, 2, 3, 4])
    const entries = readZip(file.bytes)
    expect(entries.map((e) => e.path)).toEqual(['Square/Hero.png', 'Square/Hero 2.png', 'Story 9-16/Hero.png', 'Story 9-16/Hero 2.png'])
    expect(pixelAt(entries[2]?.bytes ?? new Uint8Array(), 0, 0).size).toEqual([90, 160])
    // Each one is the file a single export gives.
    expect(entries[3]?.bytes).toEqual(exportDesign(ck, design, { pageIds: ['p2'], formatIds: ['story'], type: 'png' }, bytes).bytes)
  })

  it('the same request gives the same bytes every time', () => {
    const request = { pageIds: ['p1', 'p2'], formatIds: ['sq', 'story'], type: 'jpg' }
    expect(exportDesign(ck, design, request, bytes).bytes).toEqual(exportDesign(ck, design, request, bytes).bytes)
  })

  it('refuses a request for a page or format the design does not have, or a bad quality', () => {
    expect(() => exportDesign(ck, design, { pageIds: ['nope'], formatIds: ['sq'], type: 'png' }, bytes)).toThrow(/no page "nope"/)
    expect(() => exportDesign(ck, design, { pageIds: ['p1'], formatIds: ['nope'], type: 'png' }, bytes)).toThrow(/no format "nope"/)
    expect(() => exportDesign(ck, design, { pageIds: ['p1'], formatIds: ['sq'], type: 'jpg', quality: 0 }, bytes)).toThrow()
  })

  it('names are safe on every file system', () => {
    expect(fileName('{design}/{page}', { design: 'A:B', page: '..x', format: 'f' })).toBe('A-B-..x')
    expect(fileName('{page}', { design: 'd', page: '   ', format: 'f' })).toBe('untitled')
  })
})

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a zip that unzip reads back, names in UTF-8', () => {
    const entries = [{ path: 'Carré/a.txt', bytes: new TextEncoder().encode('hello') }, { path: 'b.bin', bytes: new Uint8Array([0, 1, 2, 255]) }]
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    writeFileSync(join(dir, 'out.zip'), zip(entries))
    execFileSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', join(dir, 'out.zip'), join(dir, 'x')])
    expect(readFileSync(join(dir, 'x', 'Carré', 'a.txt'), 'utf8')).toBe('hello')
    expect([...readFileSync(join(dir, 'x', 'b.bin'))]).toEqual([0, 1, 2, 255])
    expect(readZip(zip(entries))).toEqual(entries)
  })
})
