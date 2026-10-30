// The editor: one infinite canvas per design with every page in every format as a frame (#36),
// click to select, drag to move, typing into text, pan and zoom. It has no framework in it; the
// page only hands it a canvas and an overlay the size of the stage.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { anchorOffset, childrenOf, CommandError, openSession, readDesign, textAnchor, type Session, type TextAnchor } from '@razzlr/doc'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import {
  caretAt, caretPosition, drawPage, layerPictures, layoutText, paragraphCache, render, renderDesign, resourceCache, sceneMemo, type ResourceCache, type Resources, type Scene, type SceneLayer,
} from '@razzlr/renderer'
import { imageAssetIds, type Design } from '@razzlr/schema'
import type { CanvasKit, GrDirectContext, Image, SkPicture, Surface } from 'canvaskit-wasm'
import canvasKitModule from 'canvaskit-wasm/full'
import * as Y from 'yjs'
import { fit, toScreen, toWorld, visibleRect, zoomAt, type Camera, type Viewport } from './camera.ts'
import { frameAt, frameGrid, intersects, type Frame, type Rect } from './grid.ts'
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
  /** The stored bytes of an image asset (#35); designs with image fills need it. */
  assetBytes?: (assetId: string) => Promise<Uint8Array>
  /** The format to show first, zoomed to fit on the first page; every frame when left out. */
  formatId?: string
  onStatus?: (status: string) => void
  /** Called with the zoom (1 is 100%) whenever it changes. */
  onZoom?: (zoom: number) => void
  /** Aborting it while the editor is still connecting stops it, freeing what it made. */
  signal?: AbortSignal
}

/** A layer as one frame shows it: selection, dragging and typing all happen in one frame. */
interface Picked { id: string; frame: string }
/** The caret is anchored in the text, so edits arriving from other tabs carry it along. */
interface Editing extends Picked { caret: TextAnchor; endGesture: () => void }
/** What the select tool does with a drag on empty canvas and the hand tool with any drag. */
export type Tool = 'select' | 'hand'

/** What one redraw did, for the frame budget checks. */
export interface DrawInfo {
  /** Time spent drawing, from reading the design to submitting the frame. */
  ms: number
  /** Frames drawn; the rest were out of view and skipped. */
  drawn: number
  frames: number
  /** Frames whose picture was recorded again because they changed. */
  recorded: number
}

/** A frame's scene and its recorded drawing, kept until the layers it shows change. */
interface FrameCache { deps: unknown[]; scene: Scene; picture: SkPicture | null }

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])
const ZOOM_STEP = 2

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
    // The first frame and any export need every image the design names, so they load first.
    const images = await loadImages(imageAssetIds(readDesign(doc)), options)
    return live(ck, cache, { ...resourceBytes, images }, doc, provider, options)
  } catch (error) {
    provider.destroy()
    doc.destroy()
    cache.delete()
    throw error
  }
}

async function loadImages(ids: string[], options: EditorOptions): Promise<Record<string, Uint8Array>> {
  if (ids.length === 0) return {}
  const { assetBytes } = options
  if (!assetBytes) throw new Error('the design has images, but the editor was given no way to load them')
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await assetBytes(id)] as const)))
}


/** The editor once the design has arrived: everything it makes is freed by `destroy`. */
function live(
  ck: CanvasKit, cache: ResourceCache, firstBytes: Parameters<typeof renderDesign>[4],
  doc: Y.Doc, provider: HocuspocusProvider, options: EditorOptions,
) {
  const { canvas, overlay } = options
  let resourceBytes = firstBytes
  let resources = cache.resources(resourceBytes)
  const status = options.onStatus ?? (() => {})

  const maybeGl = ck.MakeWebGLContext(ck.GetWebGLContext(canvas))
  if (!maybeGl) throw new Error('this browser has no WebGL')
  const gl: GrDirectContext = maybeGl
  let surface: Surface | null = null
  let dpr = 1
  let viewport: Viewport = { width: 1, height: 1 }
  const session: Session = openSession(doc)
  // Removes every listener the editor adds, on destroy.
  const listening = new AbortController()
  const on = { signal: listening.signal }

  let design: Design = session.design()
  let grid = frameGrid(design)
  let camera: Camera = { x: 0, y: 0, zoom: 1 }
  let tool: Tool = 'select'
  let selected: Picked | null = null
  let editing: Editing | null = null
  /** Called after every redraw with the design it drew; the two-tab test times edits with it. */
  const drawListeners = new Set<(design: Design, at: number, info: DrawInfo) => void>()

  const frameOf = (key: string | undefined) => grid.frames.find((f) => f.key === key)
  const firstPage = () => grid.frames[0]?.pageId ?? ''

  // Scenes and pictures by frame. A frame is recorded again only when a layer it shows, an
  // override in its format, its page or its format changed: dragging in one format leaves the
  // other formats' pictures as they are, and panning records nothing.
  const frames = new Map<string, FrameCache>()
  let picturesFor: Resources | null = null
  // Text laid out and layers recorded once and kept: recording a frame again records only the
  // layers that changed, and lays out only the text that did.
  const paragraphs = paragraphCache()
  const scenes = sceneMemo()
  const layers = layerPictures()
  let recordingWith: { for: Resources; resources: Resources } | null = null
  const withParagraphs = (screen: Resources) => {
    if (recordingWith?.for !== screen) recordingWith = { for: screen, resources: { ...screen, paragraphs, layers } }
    return recordingWith.resources
  }
  const scope = (frame: Frame) => `format:${frame.formatId}`

  function depsOf(frame: Frame) {
    const overrides = design.overrides[scope(frame)]
    const deps: unknown[] = [design.pages[frame.pageId], design.formats[frame.formatId]]
    const walk = (parentId: string) => {
      for (const [id, node] of childrenOf(design, parentId)) {
        deps.push(id, node, overrides?.[id])
        walk(id)
      }
    }
    walk(frame.pageId)
    return deps
  }

  function cached(frame: Frame): FrameCache {
    const deps = depsOf(frame)
    const entry = frames.get(frame.key)
    if (entry && sameDeps(entry.deps, deps)) return entry
    entry?.picture?.delete()
    const fresh = { deps, scene: render(design, frame.pageId, frame.formatId, scenes), picture: null }
    frames.set(frame.key, fresh)
    return fresh
  }

  function record(scene: Scene, with_: Resources) {
    const recorder = new ck.PictureRecorder()
    try {
      drawPage(ck, recorder.beginRecording(ck.XYWHRect(0, 0, scene.width, scene.height)), scene, with_)
      return recorder.finishRecordingAsPicture()
    } finally {
      recorder.delete()
    }
  }

  const find = (layers: SceneLayer[], id: string): SceneLayer | undefined => {
    for (const l of layers) {
      if (l.id === id) return l
      const inner = find(l.children, id)
      if (inner) return inner
    }
    return undefined
  }
  /** The layer as a frame shows it now, with the frame. */
  function pickedLayer(picked: Picked | null) {
    const frame = picked && frameOf(picked.frame)
    const layer = frame && find(cached(frame).scene.layers, picked.id)
    return frame && layer ? { frame, layer } : null
  }

  /** The editing layer's paragraph, laid out as drawn; the caller deletes it. */
  function editingParagraph() {
    const found = pickedLayer(editing)
    if (found?.layer.type !== 'text') return null
    return { ...found, layer: found.layer, ...layoutText(ck, found.layer.props, resources) }
  }

  const px = (n: number) => `${n}px`
  /** Screen pixels a frame needs before it gets a label. */
  const MIN_LABEL_WIDTH = 56
  /** How far a label stays from the stage's start edge when its frame runs past it. */
  const LABEL_INSET = 8
  /** A design-pixel box in a frame, as CSS on the overlay. */
  function placeBox(el: HTMLElement, frame: Frame, box: Rect) {
    const at = toScreen(camera, { x: frame.x + box.x, y: frame.y + box.y })
    Object.assign(el.style, { left: px(at.x), top: px(at.y), width: px(box.width * camera.zoom), height: px(box.height * camera.zoom) })
  }

  function frameLabel(frame: Frame, drawnFrames: Frame[]) {
    const format = design.formats[frame.formatId]
    const page = design.pages[frame.pageId]
    if (!format || !page) return null
    const label = document.createElement('div')
    label.className = 'frame-label'
    label.dataset.frame = frame.key
    if (selected?.frame === frame.key || editing?.frame === frame.key) label.dataset.active = ''
    const at = toScreen(camera, frame)
    // A frame running off the stage's start keeps its label in view, along the part still showing.
    const left = Math.max(at.x, LABEL_INSET)
    const width = at.x + frame.width * camera.zoom - left
    // Too narrow to read even a cut name: zoomed far out, the frames speak for themselves.
    if (width < MIN_LABEL_WIDTH) return null
    Object.assign(label.style, { left: px(left), top: px(at.y), width: px(width) })
    const name = document.createElement('span')
    name.className = 'frame-name'
    const pages = new Set(drawnFrames.map((f) => f.pageId)).size > 1 || Object.keys(design.pages).length > 1
    name.textContent = pages ? `${page.name} · ${format.name}` : format.name
    label.append(name)
    if (width >= 120) {
      const size = document.createElement('span')
      size.className = 'frame-size'
      size.textContent = `${format.width} × ${format.height}`
      label.append(size)
    }
    return label
  }

  let drawnFrames: Frame[] = []
  function drawOverlay() {
    const parts: HTMLElement[] = []
    for (const frame of drawnFrames) {
      const label = frameLabel(frame, drawnFrames)
      if (label) parts.push(label)
    }
    const picked = pickedLayer(selected)
    if (picked) {
      const box = document.createElement('div')
      box.className = 'selection'
      box.dataset.layer = picked.layer.id
      box.dataset.frame = picked.frame.key
      placeBox(box, picked.frame, picked.layer.props)
      box.style.transform = `rotate(${picked.layer.props.rotation}deg)`
      parts.push(box)
    }
    const text = editingParagraph()
    const offset = editing && anchorOffset(doc, editing.caret)
    if (text && offset !== null && offset !== undefined) {
      const at = caretPosition(ck, text.paragraph, text.layer.props.text, offset)
      text.paragraph.delete()
      const caret = document.createElement('div')
      caret.className = 'caret'
      placeBox(caret, text.frame, { x: text.layer.props.x + at.x, y: text.layer.props.y + text.dy + at.y, width: 0, height: at.height })
      caret.style.width = ''
      parts.push(caret)
    } else {
      text?.paragraph.delete()
    }
    overlay.replaceChildren(...parts)
  }

  const backing = new ck.Paint()
  backing.setColor(ck.WHITE)
  const edge = new ck.Paint()
  edge.setStyle(ck.PaintStyle.Stroke)
  // Width 0 is a hairline: one device pixel at any zoom.
  edge.setStrokeWidth(0)
  edge.setColor(ck.Color(0, 0, 0, 0.12))

  function draw() {
    const started = performance.now()
    design = session.design()
    grid = frameGrid(design)
    if (selected && !pickedLayer(selected)) selected = null
    if (editing && !pickedLayer(editing)) stopEditing()
    if (!surface) return

    const screen = screenResources(design)
    if (screen !== picturesFor) {
      for (const entry of frames.values()) {
        entry.picture?.delete()
        entry.picture = null
      }
      picturesFor = screen
    }
    const kept = new Set(grid.frames.map((f) => f.key))
    for (const [key, entry] of frames) {
      if (kept.has(key)) continue
      entry.picture?.delete()
      frames.delete(key)
    }

    const view = visibleRect(camera, viewport)
    drawnFrames = grid.frames.filter((frame) => intersects(frame, view))
    let recorded = 0
    const c = surface.getCanvas()
    c.clear(ck.TRANSPARENT)
    c.save()
    c.scale(dpr, dpr)
    c.translate(camera.x, camera.y)
    c.scale(camera.zoom, camera.zoom)
    for (const frame of drawnFrames) {
      const entry = cached(frame)
      if (!entry.picture) {
        entry.picture = record(entry.scene, withParagraphs(screen))
        recorded++
      }
      const box = ck.XYWHRect(frame.x, frame.y, frame.width, frame.height)
      c.drawRect(box, backing)
      c.save()
      c.translate(frame.x, frame.y)
      c.drawPicture(entry.picture)
      c.restore()
      c.drawRect(box, edge)
    }
    c.restore()
    surface.flush()
    drawOverlay()
    const info = { ms: performance.now() - started, drawn: drawnFrames.length, frames: grid.frames.length, recorded }
    const at = performance.timeOrigin + performance.now()
    for (const listener of drawListeners) listener(design, at, info)
  }

  // Images that arrive after the design (another tab added them) load in the background; until
  // then the screen draws them clear. Exports never do: they throw until every image is loaded.
  const maybeClear = ck.MakeImage({ width: 1, height: 1, alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB }, new Uint8Array(4), 4)
  if (!maybeClear) throw new Error('could not make the image placeholder')
  const clear: Image = maybeClear
  const loading = new Set<string>()
  /** The last resources with placeholders, kept while the same images are missing so pictures stay. */
  let placeholders: { for: Resources; missing: string; resources: Resources } | null = null
  function screenResources(current: Design): Resources {
    const missing = imageAssetIds(current).filter((id) => !resources.images.has(id))
    if (missing.length === 0) return resources
    const fresh = missing.filter((id) => !loading.has(id))
    if (fresh.length > 0 && options.assetBytes) {
      for (const id of fresh) loading.add(id)
      loadImages(fresh, options).then((images) => {
        if (listening.signal.aborted) return
        resourceBytes = { ...resourceBytes, images: { ...resourceBytes.images, ...images } }
        resources = cache.resources(resourceBytes)
        redraw()
      }, (error: unknown) => status(`Error: an image did not load (${error instanceof Error ? error.message : String(error)})`))
        .finally(() => { for (const id of fresh) loading.delete(id) })
    }
    const key = missing.join('\n')
    if (placeholders?.for === resources && placeholders.missing === key) return placeholders.resources
    const images = new Map(resources.images)
    for (const id of missing) images.set(id, clear)
    placeholders = { for: resources, missing: key, resources: { ...resources, images } }
    return placeholders.resources
  }

  let pending = 0
  const redraw = () => {
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0
      draw()
    })
  }
  doc.on('update', redraw)

  function setCamera(next: Camera) {
    const zoomed = next.zoom !== camera.zoom
    camera = next
    if (zoomed) options.onZoom?.(camera.zoom)
    redraw()
  }

  // The canvas fills the stage; its backing store matches the screen's pixels.
  function resize() {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.round(width * dpr)
    const pixelHeight = Math.round(height * dpr)
    viewport = { width, height }
    if (surface && canvas.width === pixelWidth && canvas.height === pixelHeight) return
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    surface?.delete()
    surface = ck.MakeOnScreenGLSurface(gl, pixelWidth, pixelHeight, ck.ColorSpace.SRGB)
    if (!surface) throw new Error('could not make the WebGL surface')
    redraw()
  }
  const resized = new ResizeObserver(() => resize())
  resized.observe(canvas)

  const centre = (): Point => ({ x: viewport.width / 2, y: viewport.height / 2 })
  function fitAll() {
    setCamera(fit(grid.bounds, viewport))
  }
  function fitFrame(frame: Frame | undefined) {
    if (frame) setCamera(fit(frame, viewport))
  }
  function fitSelection() {
    const picked = pickedLayer(selected)
    if (!picked) return fitAll()
    const { frame, layer } = picked
    setCamera(fit({ x: frame.x + layer.props.x, y: frame.y + layer.props.y, width: layer.props.width, height: layer.props.height }, viewport))
  }
  const zoomTo = (zoom: number, at: Point = centre()) => setCamera(zoomAt(camera, at, zoom))

  // Pointer: screen points are CSS pixels from the canvas's corner.
  const screenOf = (e: MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  /** The frame under the pointer and the point in its page's design pixels. */
  function pointIn(e: MouseEvent) {
    const world = toWorld(camera, screenOf(e))
    const frame = frameAt(grid.frames, world)
    return frame ? { frame, p: { x: world.x - frame.x, y: world.y - frame.y } } : null
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

  let drag: { id: string; frame: Frame; from: Point; x: number; y: number; end: () => void } | null = null
  let pan: { from: Point; camera: Camera } | null = null
  let spaceHeld = false
  const panning = () => tool === 'hand' || spaceHeld
  const showCursor = () => {
    canvas.style.cursor = pan ? 'grabbing' : panning() ? 'grab' : ''
  }

  canvas.addEventListener('pointerdown', (e) => {
    // Middle button, space or the hand tool pan; nothing else does.
    if (e.button === 1 || (e.button === 0 && panning())) {
      e.preventDefault()
      canvas.setPointerCapture(e.pointerId)
      pan = { from: { x: e.clientX, y: e.clientY }, camera }
      showCursor()
      return
    }
    if (e.button !== 0) return
    const at = pointIn(e)
    const hit = at && hitTest(cached(at.frame).scene.layers, at.p)
    if (at && editing && hit?.id === editing.id && editing.frame === at.frame.key) {
      editing.caret = textAnchor(doc, editing.id, caretFromPoint(at.p))
      drawOverlay()
      return
    }
    stopEditing()
    selected = at && hit ? { id: hit.id, frame: at.frame.key } : null
    drawOverlay()
    if (!at || !hit) return
    canvas.setPointerCapture(e.pointerId)
    drag = { id: hit.id, frame: at.frame, from: at.p, x: hit.props.x, y: hit.props.y, end: session.beginGesture() }
  }, on)
  canvas.addEventListener('pointermove', (e) => {
    if (pan) {
      setCamera({ ...pan.camera, x: pan.camera.x + e.clientX - pan.from.x, y: pan.camera.y + e.clientY - pan.from.y })
      return
    }
    if (!drag) return
    const world = toWorld(camera, screenOf(e))
    const { id, frame } = drag
    const x = Math.round(drag.x + world.x - frame.x - drag.from.x)
    const y = Math.round(drag.y + world.y - frame.y - drag.from.y)
    // A move writes this format's override; the other formats keep their layout. Another tab may
    // delete the layer mid-drag; the drag then just stops moving anything.
    runQuietly(() => session.run('node.update', { ids: [id], scope: scope(frame), patch: { x, y } }))
  }, on)
  const endDrag = () => {
    drag?.end()
    drag = null
    pan = null
    showCursor()
  }
  canvas.addEventListener('pointerup', endDrag, on)
  canvas.addEventListener('pointercancel', endDrag, on)
  canvas.addEventListener('dblclick', (e) => {
    if (panning()) return
    const at = pointIn(e)
    const hit = at && hitTest(cached(at.frame).scene.layers, at.p)
    if (!at || hit?.type !== 'text') return
    stopEditing()
    selected = { id: hit.id, frame: at.frame.key }
    editing = { ...selected, caret: textAnchor(doc, hit.id, 0), endGesture: session.beginGesture() }
    editing.caret = textAnchor(doc, hit.id, caretFromPoint(at.p))
    drawOverlay()
  }, on)

  // Wheel and trackpad: scrolling pans; pinching (which Chromium sends as ctrl-wheel) and
  // ctrl- or cmd-wheel zoom about the pointer.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.height : 1
    if (e.ctrlKey || e.metaKey) {
      const delta = Math.max(-30, Math.min(30, e.deltaY * unit))
      zoomTo(camera.zoom * Math.exp(-delta * 0.01), screenOf(e))
      return
    }
    const sideways = e.shiftKey && e.deltaX === 0
    const dx = (sideways ? e.deltaY : e.deltaX) * unit
    const dy = (sideways ? 0 : e.deltaY) * unit
    setCamera({ ...camera, x: camera.x - dx, y: camera.y - dy })
  }, { ...on, passive: false })

  const graphemeEdges = (text: string) => [0, ...[...graphemes.segment(text)].map((g) => g.index + g.segment.length)]
  /** Keys typed into the page's own fields belong to them. */
  const inField = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

  /** Canvas keys: zoom shortcuts and space to pan. Returns whether it handled the key. */
  function viewKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (e.shiftKey && !mod && e.code === 'Digit1') fitAll()
    else if (e.shiftKey && !mod && e.code === 'Digit2') fitSelection()
    else if ((e.shiftKey && !mod && e.code === 'Digit0') || (mod && e.key === '0')) zoomTo(1)
    else if (mod && (e.key === '=' || e.key === '+')) zoomTo(camera.zoom * ZOOM_STEP)
    else if (mod && e.key === '-') zoomTo(camera.zoom / ZOOM_STEP)
    else if (e.code === 'Space' && !mod) {
      if (!spaceHeld) {
        spaceHeld = true
        showCursor()
      }
    } else return false
    return true
  }

  function onKey(e: KeyboardEvent) {
    if (inField(e.target)) return
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
      if (viewKey(e)) {
        e.preventDefault()
      } else if (e.key === 'Escape') {
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
      // Text is shared by every format, so typing writes the base. The anchor sits after the
      // character before the caret, so inserting at the caret leaves it before the new text; it
      // is moved past it.
      if (runQuietly(() => session.run('text.edit', { id, op: { kind: 'insert', at: caret, text: e.key } }))) moveTo(caret + e.key.length)
    } else {
      return
    }
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey, on)
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return
    spaceHeld = false
    showCursor()
  }, on)
  window.addEventListener('blur', () => {
    spaceHeld = false
    showCursor()
  }, on)

  resize()
  const firstFormat = options.formatId ? frameOf(`${firstPage()}/${options.formatId}`) : undefined
  if (firstFormat) fitFrame(firstFormat)
  else fitAll()
  options.onZoom?.(camera.zoom)
  draw()
  status('Live')

  const defaultFrame = (pageId?: string, formatId?: string) => {
    const page = pageId ?? firstPage()
    const format = formatId ?? design.meta.primaryFormatId
    const found = frameOf(`${page}/${format}`)
    if (!found) throw new Error(`no frame for page "${page}" in format "${format}"`)
    return found
  }

  return {
    session,
    doc,
    /** The design as the document holds it now, which can be ahead of the last redraw. */
    design: () => session.design(),
    selected: () => selected?.id ?? null,
    /** The frame the selection is in, as `<pageId>/<formatId>`. */
    selectedFrame: () => selected?.frame ?? null,
    frames: () => frameGrid(session.design()).frames,
    camera: () => camera,
    viewport: () => viewport,
    setCamera,
    zoomTo,
    zoomIn: () => zoomTo(camera.zoom * ZOOM_STEP),
    zoomOut: () => zoomTo(camera.zoom / ZOOM_STEP),
    fitAll,
    fitSelection,
    fitFrame: (pageId: string, formatId: string) => fitFrame(defaultFrame(pageId, formatId)),
    setTool(next: Tool) {
      tool = next
      showCursor()
    },
    /** Where a design pixel of one frame is on screen now, in client coordinates; the first page and the primary format by default. */
    screenPoint(x: number, y: number, pageId?: string, formatId?: string): Point {
      const frame = defaultFrame(pageId, formatId)
      const at = toScreen(camera, { x: frame.x + x, y: frame.y + y })
      const rect = canvas.getBoundingClientRect()
      return { x: rect.left + at.x, y: rect.top + at.y }
    },
    /** Resolves once what the screen shows is up to date: after the pending redraw, if there is one. */
    drawn: () => new Promise<void>((resolve) => {
      if (!pending) return resolve()
      const listener = () => {
        drawListeners.delete(listener)
        resolve()
      }
      drawListeners.add(listener)
    }),
    onDraw(listener: (design: Design, at: number, info: DrawInfo) => void) {
      drawListeners.add(listener)
      return () => drawListeners.delete(listener)
    },
    /** The export render of one frame as this tab holds it now, on the CPU surface, as RGBA; the first page in the primary format by default. */
    exportPixels(pageId?: string, formatId?: string) {
      const frame = defaultFrame(pageId, formatId)
      return renderDesign(ck, session.design(), frame.pageId, frame.formatId, resourceBytes, cache).pixels
    },
    synced: () => provider.synced && provider.unsyncedChanges === 0,
    destroy() {
      listening.abort()
      resized.disconnect()
      cancelAnimationFrame(pending)
      drawListeners.clear()
      doc.off('update', redraw)
      for (const entry of frames.values()) entry.picture?.delete()
      frames.clear()
      paragraphs.delete()
      layers.delete()
      session.destroy()
      provider.destroy()
      doc.destroy()
      cache.delete()
      clear.delete()
      backing.delete()
      edge.delete()
      surface?.delete()
      gl.delete()
    },
  }
}
export type Editor = ReturnType<typeof live>
