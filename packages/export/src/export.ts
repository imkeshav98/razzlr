// Exports (#55, #56): one function per file type. PNG and JPG are drawn on the CPU surface
// (ADR-0005) and PDF and SVG on Skia's PDF and SVG canvases, by the render seam, so the browser's
// export worker and Node make the same bytes from the same design.
import { renderDesign, renderVector, type ResourceBytes, type ResourceCache } from '@razzlr/renderer'
import { ExportRequest, parseDesign, type Design, type ExportType } from '@razzlr/schema'
import type { CanvasKit } from '@razzlr/canvaskit'
import { zip } from './zip.ts'

export interface ExportedFile {
  /** The file's name, or its path inside the zip. */
  name: string
  type: string
  bytes: Uint8Array
}

const MIME: Record<ExportType | 'zip', string> = {
  png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', svg: 'image/svg+xml', zip: 'application/zip',
}

/** One page in one format as a PNG, transparency kept. */
export function exportPng(ck: CanvasKit, design: Design, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache): Uint8Array {
  return renderDesign(ck, design, pageId, formatId, bytes, cache).png
}

/** One page in one format as a JPG at a quality from 1 to 100, over white where the page is see-through. */
export function exportJpg(
  ck: CanvasKit, design: Design, pageId: string, formatId: string, bytes: ResourceBytes, quality: number, cache?: ResourceCache,
): Uint8Array {
  const { width, height, pixels } = renderDesign(ck, design, pageId, formatId, bytes, cache)
  const opaque = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 255
    // Integer blending, so every runtime rounds the same way.
    for (let c = 0; c < 3; c++) opaque[i + c] = Math.round(((pixels[i + c] ?? 0) * a + 255 * (255 - a)) / 255)
    opaque[i + 3] = 255
  }
  const image = ck.MakeImage({ width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Opaque, colorSpace: ck.ColorSpace.SRGB }, opaque, width * 4)
  if (!image) throw new Error('CanvasKit could not make the image to encode')
  try {
    const jpg = image.encodeToBytes(ck.ImageFormat.JPEG, quality)
    if (!jpg) throw new Error('CanvasKit could not encode the JPG')
    return jpg
  } finally {
    image.delete()
  }
}

/**
 * One page in one format as a one-page PDF for print: shapes and text stay vectors, text keeps its
 * fonts embedded and can be selected, and a page unit is one pixel of the format.
 */
export function exportPdf(ck: CanvasKit, design: Design, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache): Uint8Array {
  return renderVector(ck, design, pageId, formatId, bytes, 'pdf', cache, { title: design.meta.name })
}

/** One page in one format as an SVG, its text drawn as shapes so it looks the same in every app. */
export function exportSvg(ck: CanvasKit, design: Design, pageId: string, formatId: string, bytes: ResourceBytes, cache?: ResourceCache): Uint8Array {
  return renderVector(ck, design, pageId, formatId, bytes, 'svg', cache)
}

/** A name safe on every file system: no path separators or reserved characters, never empty. */
function safe(part: string) {
  // eslint-disable-next-line no-control-regex
  const cleaned = part.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return cleaned || 'untitled'
}

/** A file name from the request's template, its tokens filled in. */
export function fileName(template: string, values: { design: string; page: string; format: string }): string {
  return safe(template.replace(/\{(design|page|format)\}/g, (_, token: keyof typeof values) => values[token]))
}

/**
 * The request's pages in its formats, each one file, named from the request's template. One
 * file comes as itself; more come as one zip with a folder per format. `onFile` hears each file
 * as it is made, so a caller can show progress.
 */
export function exportDesign(
  ck: CanvasKit, json: unknown, input: unknown, bytes: ResourceBytes, cache?: ResourceCache, onFile?: (done: number, total: number) => void,
): ExportedFile {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const design = parsed.design
  const request = ExportRequest.parse(input)
  const jobs = request.formatIds.flatMap((formatId) => request.pageIds.map((pageId) => ({ pageId, formatId })))
  const taken = new Set<string>()
  const files = jobs.map(({ pageId, formatId }, i) => {
    const page = design.pages[pageId]
    const format = design.formats[formatId]
    if (!page) throw new Error(`no page "${pageId}"`)
    if (!format) throw new Error(`no format "${formatId}"`)
    const image = {
      png: () => exportPng(ck, design, pageId, formatId, bytes, cache),
      jpg: () => exportJpg(ck, design, pageId, formatId, bytes, request.quality, cache),
      pdf: () => exportPdf(ck, design, pageId, formatId, bytes, cache),
      svg: () => exportSvg(ck, design, pageId, formatId, bytes, cache),
    }[request.type]()
    const base = fileName(request.name, { design: design.meta.name, page: page.name, format: format.name })
    const folder = jobs.length > 1 ? `${safe(format.name)}/` : ''
    // Two pages may share a name: the later ones get a number.
    let name = `${folder}${base}.${request.type}`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${folder}${base} ${n}.${request.type}`
    taken.add(name.toLowerCase())
    onFile?.(i + 1, jobs.length)
    return { name, type: MIME[request.type], bytes: image }
  })
  const [only] = files
  if (files.length === 1 && only) return only
  return { name: `${safe(design.meta.name)}.zip`, type: MIME.zip, bytes: zip(files.map((f) => ({ path: f.name, bytes: f.bytes }))) }
}
