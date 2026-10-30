// The bare editor of the phase 0 spike (#8): a stage, click to select, drag to move and typing
// into text. It has no framework in it; the page only hands it a canvas and an overlay.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { anchorOffset, CommandError, openSession, readDesign, textAnchor, type Session, type TextAnchor } from '@razzlr/doc'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import {
  caretAt, caretPosition, drawScene, layoutText, render, renderDesign, resourceCache, type ResourceCache, type Scene, type SceneLayer,
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
  /** A sync token for the design, fetched again whenever the editor (re)connects (#34). */
  syncToken: () => Promise<string>
  formatId?: string
  onStatus?: (status: string) => void
  /** Aborting it while the editor is still connecting stops it, freeing what it made. */
  signal?: AbortSignal
}

/** The caret is anchored in the text, so edits arriving from other tabs carry it along. */
interface Editing { id: string; caret: TextAnchor; endGesture: () => void }

/**
 * Runs a command that edits from other tabs may have made impossible, such as typing into a layer
 * just deleted elsewhere: it is refused whole and nothing happens. Returns whether it ran.
 */
function runQuietly(run: () => unknown) {
  try {
    run()
    return true
  } catch (error) {
    if (error instanceof CommandError) return false
    throw error
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

async function bytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function startEditor(options: EditorOptions) {
  const { designId, syncUrl } = options
  const status = options.onStatus ?? (() => {})
  status('Loading renderer')
  const ck: CanvasKit = await CanvasKitInit({ locateFile: (file: string) => `/vendor/${file}` })
  const fontBytes = await Promise.all(FONT_FACES.map(async (f) => ({ family: f.family, bytes: await bytes(`/vendor/fonts/${f.file}`) })))
  const resourceBytes = { fonts: fontBytes, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }
  // One cache for the screen and exports: fonts and images are decoded once for the editor's life.
  const cache = resourceCache(ck)
  cache.resources(resourceBytes)
  status('Connecting')
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({
    url: syncUrl, name: designId, document: doc, token: options.syncToken,
    onAuthenticationFailed: ({ reason }) => status(`Error: the sync server refused this design (${reason})`),
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => reject(new Error('stopped while connecting'))
      if (options.signal?.aborted) stop()
      options.signal?.addEventListener('abort', stop)
      if (provider.synced) resolve()
      else provider.on('synced', () => resolve())
    })
    return live(ck, cache, resourceBytes, doc, provider, options)
  } catch (error) {
    provider.destroy()
    doc.destroy()
    cache.delete()
    throw error
  }
}

/** The editor once the design has arrived: everything it makes is freed by `destroy`. */
function live(
  ck: CanvasKit, cache: ResourceCache, resourceBytes: Parameters<typeof renderDesign>[4],
  doc: Y.Doc, provider: HocuspocusProvider, options: EditorOptions,
) {
  const { canvas, overlay, designId } = options
  const resources = cache.resources(resourceBytes)
  const status = options.onStatus ?? (() => {})

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
  const session: Session = openSession(doc)
  // Removes every listener the editor adds, on destroy.
  const listening = new AbortController()
  const on = { signal: listening.signal }

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
    const offset = editing && anchorOffset(doc, editing.caret)
    if (text && offset !== null && offset !== undefined) {
      const at = caretPosition(ck, text.paragraph, text.layer.props.text, offset)
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
    design = session.design()
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
  // The canvas is shown scaled to fit, so the overlay's scale changes when the page is resized.
  const resized = new ResizeObserver(() => drawOverlay())
  resized.observe(canvas)

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
      editing.caret = textAnchor(doc, editing.id, caretFromPoint(p))
      drawOverlay()
      return
    }
    stopEditing()
    selected = hit?.id ?? null
    drawOverlay()
    if (!hit) return
    canvas.setPointerCapture(e.pointerId)
    drag = { id: hit.id, from: p, x: hit.props.x, y: hit.props.y, end: session.beginGesture() }
  }, on)
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const p = toPage(e)
    const { id } = drag
    const x = Math.round(drag.x + p.x - drag.from.x)
    const y = Math.round(drag.y + p.y - drag.from.y)
    // Another tab may delete the layer mid-drag; the drag then just stops moving anything.
    runQuietly(() => session.run('node.update', { ids: [id], patch: { x, y } }))
  }, on)
  const endDrag = () => {
    drag?.end()
    drag = null
  }
  canvas.addEventListener('pointerup', endDrag, on)
  canvas.addEventListener('pointercancel', endDrag, on)
  canvas.addEventListener('dblclick', (e) => {
    const p = toPage(e)
    const hit = hitTest(scene.layers, p)
    if (hit?.type !== 'text') return
    stopEditing()
    selected = hit.id
    editing = { id: hit.id, caret: textAnchor(doc, hit.id, 0), endGesture: session.beginGesture() }
    editing.caret = textAnchor(doc, hit.id, caretFromPoint(p))
    drawOverlay()
  }, on)

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
    // The document, not the last drawn scene: keys can come faster than redraws.
    const node = session.design().nodes[editing.id]
    if (node?.type !== 'text') return
    const text = node.props.text
    const edges = graphemeEdges(text)
    const caret = Math.min(anchorOffset(doc, editing.caret) ?? 0, text.length)
    const { id } = editing
    const moveTo = (offset: number) => {
      if (editing) editing.caret = textAnchor(doc, id, offset)
    }
    if (e.key === 'Escape') {
      stopEditing()
      drawOverlay()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Logical order: right-to-left text moves the other way on screen, as most editors do.
      moveTo(e.key === 'ArrowRight' ? (edges.find((x) => x > caret) ?? caret) : (edges.findLast((x) => x < caret) ?? caret))
      drawOverlay()
    } else if (e.key === 'Backspace' && caret > 0) {
      const from = edges.findLast((x) => x < caret) ?? 0
      runQuietly(() => session.run('text.edit', { id, op: { kind: 'delete', at: from, length: caret - from } }))
    } else if (e.key === 'Delete' && caret < text.length) {
      const to = edges.find((x) => x > caret) ?? text.length
      runQuietly(() => session.run('text.edit', { id, op: { kind: 'delete', at: caret, length: to - caret } }))
    } else if (e.key.length > 0 && [...e.key].length === 1 && !mod) {
      // The anchor sits after the character before the caret, so inserting at the caret leaves it
      // before the new text; it is moved past it.
      if (runQuietly(() => session.run('text.edit', { id, op: { kind: 'insert', at: caret, text: e.key } }))) moveTo(caret + e.key.length)
    } else {
      return
    }
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey, on)

  draw()
  status('Live')

  return {
    session,
    doc,
    /** The design as the document holds it now, which can be ahead of the last redraw. */
    design: () => session.design(),
    selected: () => selected,
    onDraw(listener: (design: Design, at: number) => void) {
      drawListeners.add(listener)
      return () => drawListeners.delete(listener)
    },
    /** The export render of what this tab holds now, on the CPU surface, as RGBA. */
    exportPixels: () => renderDesign(ck, session.design(), pageId, formatId, resourceBytes, cache).pixels,
    synced: () => provider.synced && provider.unsyncedChanges === 0,
    destroy() {
      listening.abort()
      resized.disconnect()
      cancelAnimationFrame(frame)
      drawListeners.clear()
      doc.off('update', redraw)
      session.destroy()
      provider.destroy()
      doc.destroy()
      cache.delete()
      surface.dispose()
    },
  }
}
export type Editor = Awaited<ReturnType<typeof startEditor>>
