// The bare editor of the phase 0 spike (#8): a stage, click to select, drag to move and typing
// into text. It has no framework in it; the page only hands it a canvas and an overlay.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { openSession, readDesign, type Session } from '@razzlr/doc'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import {
  caretAt, caretPosition, drawScene, layoutText, makeResources, render, renderDesign, type Scene, type SceneLayer,
} from '@razzlr/renderer'
import type { Design } from '@razzlr/schema'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import canvasKitModule from 'canvaskit-wasm/full'
import * as Y from 'yjs'
import { hitTest, type Point } from './hit-test.ts'

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('canvaskit-wasm').default

export interface EditorOptions {
  canvas: HTMLCanvasElement
  /** Holds the selection outline and the caret, laid over the canvas at the same size. */
  overlay: HTMLElement
  designId: string
  syncUrl: string
  formatId?: string
  onStatus?: (status: string) => void
}

interface Editing { id: string; caret: number; endGesture: () => void }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

async function bytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function startEditor(options: EditorOptions) {
  const { canvas, overlay, designId, syncUrl } = options
  const status = options.onStatus ?? (() => {})
  status('Loading renderer')
  const ck: CanvasKit = await CanvasKitInit({ locateFile: (file: string) => `/vendor/${file}` })
  const fontBytes = await Promise.all(FONT_FACES.map(async (f) => ({ family: f.family, bytes: await bytes(`/vendor/fonts/${f.file}`) })))
  const resourceBytes = { fonts: fontBytes, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }
  const resources = makeResources(ck, resourceBytes)

  status('Connecting')
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ url: syncUrl, name: designId, document: doc })
  await new Promise<void>((resolve) => {
    if (provider.synced) resolve()
    else provider.on('synced', () => resolve())
  })
  const session: Session = openSession(doc)

  const first = readDesign(doc)
  const firstPage = Object.entries(first.pages).sort(([, a], [, b]) => (a.order < b.order ? -1 : 1))[0]?.[0]
  if (!firstPage) throw new Error(`design "${designId}" has no page`)
  const pageId: string = firstPage
  const formatId = options.formatId && first.formats[options.formatId] ? options.formatId : first.meta.primaryFormatId
  const maybeFormat = first.formats[formatId]
  if (!maybeFormat) throw new Error(`no format "${formatId}"`)
  const format = maybeFormat

  canvas.width = format.width
  canvas.height = format.height
  const maybeSurface = ck.MakeWebGLCanvasSurface(canvas)
  if (!maybeSurface) throw new Error('this browser has no WebGL')
  const surface: Surface = maybeSurface

  let selected: string | null = null
  let editing: Editing | null = null
  let design: Design = first
  let scene: Scene = render(first, pageId, formatId)
  /** Called after every redraw with the design it drew; the two-tab test times edits with it. */
  const drawListeners = new Set<(design: Design, at: number) => void>()

  const find = (layers: SceneLayer[], id: string): SceneLayer | undefined => {
    for (const l of layers) {
      if (l.id === id) return l
      const inner = find(l.children, id)
      if (inner) return inner
    }
    return undefined
  }

  /** The editing layer's paragraph, laid out as drawn; the caller deletes it. */
  function editingParagraph() {
    const layer = editing && find(scene.layers, editing.id)
    if (layer?.type !== 'text') return null
    return { layer, ...layoutText(ck, layer.props, resources) }
  }

  function drawOverlay() {
    const scale = canvas.clientWidth / format.width
    overlay.replaceChildren()
    const layer = selected ? find(scene.layers, selected) : undefined
    if (layer) {
      const box = document.createElement('div')
      box.className = 'selection'
      box.dataset.layer = layer.id
      Object.assign(box.style, {
        left: `${layer.props.x * scale}px`, top: `${layer.props.y * scale}px`,
        width: `${layer.props.width * scale}px`, height: `${layer.props.height * scale}px`,
        transform: `rotate(${layer.props.rotation}deg)`,
      })
      overlay.append(box)
    }
    const text = editingParagraph()
    if (text && editing) {
      const at = caretPosition(ck, text.paragraph, text.layer.props.text, editing.caret)
      text.paragraph.delete()
      const caret = document.createElement('div')
      caret.className = 'caret'
      Object.assign(caret.style, {
        left: `${(text.layer.props.x + at.x) * scale}px`, top: `${(text.layer.props.y + text.dy + at.y) * scale}px`,
        height: `${at.height * scale}px`,
      })
      overlay.append(caret)
    }
  }

  function draw() {
    design = readDesign(doc)
    scene = render(design, pageId, formatId)
    if (selected && !find(scene.layers, selected)) selected = null
    if (editing && !find(scene.layers, editing.id)) stopEditing()
    drawScene(ck, surface.getCanvas(), scene, resources)
    surface.flush()
    drawOverlay()
    const at = performance.timeOrigin + performance.now()
    for (const listener of drawListeners) listener(design, at)
  }

  let frame = 0
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0
      draw()
    })
  }
  doc.on('update', redraw)

  // Pointer: canvas pixels are design pixels; the canvas is shown scaled to fit.
  const toPage = (e: PointerEvent | MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * format.width, y: ((e.clientY - rect.top) / rect.height) * format.height }
  }

  function stopEditing() {
    editing?.endGesture()
    editing = null
  }

  function caretFromPoint(p: Point) {
    const text = editingParagraph()
    if (!text) return 0
    const offset = caretAt(ck, text.paragraph, text.layer.props.text, p.x - text.layer.props.x, p.y - text.layer.props.y - text.dy)
    text.paragraph.delete()
    return offset
  }

  let drag: { id: string; from: Point; x: number; y: number; end: () => void } | null = null

  canvas.addEventListener('pointerdown', (e) => {
    const p = toPage(e)
    const hit = hitTest(scene.layers, p)
    if (editing && hit?.id === editing.id) {
      editing.caret = caretFromPoint(p)
      drawOverlay()
      return
    }
    stopEditing()
    selected = hit?.id ?? null
    drawOverlay()
    if (!hit) return
    canvas.setPointerCapture(e.pointerId)
    drag = { id: hit.id, from: p, x: hit.props.x, y: hit.props.y, end: session.beginGesture() }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const p = toPage(e)
    const x = Math.round(drag.x + p.x - drag.from.x)
    const y = Math.round(drag.y + p.y - drag.from.y)
    session.run('node.update', { ids: [drag.id], patch: { x, y } })
  })
  const endDrag = () => {
    drag?.end()
    drag = null
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('dblclick', (e) => {
    const p = toPage(e)
    const hit = hitTest(scene.layers, p)
    if (hit?.type !== 'text') return
    stopEditing()
    selected = hit.id
    editing = { id: hit.id, caret: 0, endGesture: session.beginGesture() }
    editing.caret = caretFromPoint(p)
    drawOverlay()
  })

  const graphemeEdges = (text: string) => [0, ...[...graphemes.segment(text)].map((g) => g.index + g.segment.length)]

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      endDrag()
      stopEditing()
      if (e.shiftKey) session.redo()
      else session.undo()
      return
    }
    if (!editing) {
      if (e.key === 'Escape') {
        selected = null
        drawOverlay()
      }
      return
    }
    const layer = find(scene.layers, editing.id)
    if (layer?.type !== 'text') return
    const text = layer.props.text
    const edges = graphemeEdges(text)
    const caret = editing.caret
    if (e.key === 'Escape') {
      stopEditing()
      drawOverlay()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Logical order: right-to-left text moves the other way on screen, as most editors do.
      editing.caret = e.key === 'ArrowRight' ? (edges.find((x) => x > caret) ?? caret) : (edges.findLast((x) => x < caret) ?? caret)
      drawOverlay()
    } else if (e.key === 'Backspace' && caret > 0) {
      const from = edges.findLast((x) => x < caret) ?? 0
      session.run('text.edit', { id: editing.id, op: { kind: 'delete', at: from, length: caret - from } })
      editing.caret = from
    } else if (e.key === 'Delete' && caret < text.length) {
      const to = edges.find((x) => x > caret) ?? text.length
      session.run('text.edit', { id: editing.id, op: { kind: 'delete', at: caret, length: to - caret } })
    } else if (e.key.length > 0 && [...e.key].length === 1 && !mod) {
      session.run('text.edit', { id: editing.id, op: { kind: 'insert', at: caret, text: e.key } })
      editing.caret = caret + e.key.length
    } else {
      return
    }
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey)

  draw()
  status('Live')

  return {
    session,
    doc,
    /** The design as the document holds it now, which can be ahead of the last redraw. */
    design: () => readDesign(doc),
    selected: () => selected,
    onDraw(listener: (design: Design, at: number) => void) {
      drawListeners.add(listener)
      return () => drawListeners.delete(listener)
    },
    /** The export render of what this tab holds now, on the CPU surface, as RGBA. */
    exportPixels: () => renderDesign(ck, readDesign(doc), pageId, formatId, resourceBytes).pixels,
    synced: () => provider.synced && provider.unsyncedChanges === 0,
    destroy() {
      window.removeEventListener('keydown', onKey)
      doc.off('update', redraw)
      session.destroy()
      provider.destroy()
      resources.delete()
      surface.dispose()
    },
  }
}
export type Editor = Awaited<ReturnType<typeof startEditor>>
