// Runs in Chromium. Bundled by specs/parity.spec.ts and served from memory, with the
// CanvasKit wasm, the font files and the fixture images beside it.
import { FALLBACK_FAMILY, FONT_FACES } from '@razzlr/fonts'
import { cpuSurface, renderDesign, type SurfaceMaker } from '@razzlr/renderer'
import canvasKitModule from 'canvaskit-wasm/full'

// CanvasKit quietly falls back to a CPU surface when WebGL is missing; that would fake the measurement.
const webglSurface: SurfaceMaker = (ck, width, height) => {
  const surface = ck.MakeWebGLCanvasSurface(new OffscreenCanvas(width, height))
  if (surface && !surface.reportBackendTypeIsGPU()) throw new Error('no WebGL in this browser; got a CPU surface')
  return surface
}

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('canvaskit-wasm').default

const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())

const ck = await CanvasKitInit({ locateFile: (file: string) => `/${file}` })
const fonts = await Promise.all(FONT_FACES.map(async (f) => ({ family: f.family, bytes: await bytes(`/fonts/${f.file}`) })))

function toBase64(data: Uint8Array) {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Renders one page and format, returning raw RGBA pixels as base64. */
async function renderFixture(json: unknown, pageId: string, formatId: string, surface: 'cpu' | 'webgl', assetIds: string[]) {
  const images = Object.fromEntries(await Promise.all(assetIds.map(async (id) => [id, await bytes(`/assets/${id}.jpg`)] as const)))
  const resources = { fonts, fallbackFamilies: [FALLBACK_FAMILY], images }
  const rendered = renderDesign(ck, json, pageId, formatId, resources, surface === 'cpu' ? cpuSurface : webglSurface)
  return { width: rendered.width, height: rendered.height, pixels: toBase64(rendered.pixels) }
}

Object.assign(globalThis, { renderFixture, harnessReady: true })
