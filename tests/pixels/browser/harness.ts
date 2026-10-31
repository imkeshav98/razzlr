// Runs in Chromium. Bundled by specs/parity.fixture.ts and served from memory, with the
// CanvasKit wasm, the font files and the fixture images beside it.
import { exportDesign } from '@razzlr/export'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import { drawDesign, renderDesign, type ResourceBytes } from '@razzlr/renderer'
import type { Surface } from 'canvaskit-wasm'
import canvasKitModule from 'canvaskit-wasm/full'

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('canvaskit-wasm').default

async function bytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const ck = await CanvasKitInit({ locateFile: (file: string) => `/${file}` })
const fonts = await Promise.all(FONT_FACES.map(async (f) => ({ family: f.family, bytes: await bytes(`/fonts/${f.file}`) })))

async function resourcesFor(assetIds: string[]): Promise<ResourceBytes> {
  const images = Object.fromEntries(await Promise.all(assetIds.map(async (id) => [id, await bytes(`/assets/${id}.jpg`)] as const)))
  return { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images }
}

/** One WebGL surface per size, kept for the page's life: Chromium allows only a few live WebGL contexts. */
const webglSurfaces = new Map<string, Surface>()
function webglSurface(width: number, height: number) {
  const key = `${width}×${height}`
  let surface = webglSurfaces.get(key)
  if (!surface) {
    const made = ck.MakeWebGLCanvasSurface(new OffscreenCanvas(width, height))
    // CanvasKit quietly falls back to a CPU surface when WebGL is missing; that would fake the measurement.
    if (!made?.reportBackendTypeIsGPU()) throw new Error('no WebGL in this browser')
    surface = made
    webglSurfaces.set(key, surface)
  }
  return surface
}

function toBase64(data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * Renders one page and format and returns raw RGBA pixels as base64. CPU goes through the export
 * seam; WebGL draws as the editor screen will, and is read back here only to measure its drift.
 */
async function renderFixture(json: unknown, pageId: string, formatId: string, surface: 'cpu' | 'webgl', assetIds: string[]) {
  const resources = await resourcesFor(assetIds)
  if (surface === 'cpu') {
    const { width, height, pixels } = renderDesign(ck, json, pageId, formatId, resources)
    return { width, height, pixels: toBase64(pixels) }
  }
  const format = (json as { formats: Record<string, { width: number; height: number } | undefined> }).formats[formatId]
  if (!format) throw new Error(`no format "${formatId}"`)
  const gl = webglSurface(format.width, format.height)
  const { width, height } = drawDesign(ck, gl, json, pageId, formatId, resources)
  const image = gl.makeImageSnapshot()
  const pixels = image.readPixels(0, 0, {
    width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
  })
  image.delete()
  if (!(pixels instanceof Uint8Array)) throw new Error('could not read the WebGL surface')
  return { width, height, pixels: toBase64(pixels) }
}

/** One page in one format exported as PNG or JPG, the file's bytes as base64 (#55). */
async function exportFixture(json: unknown, pageId: string, formatId: string, type: 'png' | 'jpg', assetIds: string[]) {
  const file = exportDesign(ck, json, { pageIds: [pageId], formatIds: [formatId], type, quality: 85 }, await resourcesFor(assetIds))
  return toBase64(file.bytes)
}

Object.assign(globalThis, { renderFixture, exportFixture, harnessReady: true })
