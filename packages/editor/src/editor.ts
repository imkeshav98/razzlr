// The editor: one infinite canvas per design with every page in every format as a frame (#36),
// click to select, drag to move, typing into text, pan and zoom. It has no framework in it; the
// page only hands it a canvas and an overlay the size of the stage.
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { anchorOffset, childrenOf, CommandError, openSession, readDesign, textAnchor, type Session, type TextAnchor } from '@razzlr/doc'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import {
  caretAt, caretPosition, drawPage, layerPictures, layoutText, paragraphCache, render, renderDesign, resourceCache, sceneMemo, type ResourceCache, type Resources, type Scene, type SceneLayer,
} from '@razzlr/renderer'
import { imageAssetIds, LOCK_FLAGS, type Design } from '@razzlr/schema'
import type { CanvasKit, GrDirectContext, Image, SkPicture, Surface } from 'canvaskit-wasm'
import canvasKitModule from 'canvaskit-wasm/full'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { fit, toScreen, toWorld, visibleRect, zoomAt, type Camera, type Viewport } from './camera.ts'
import { frameAt, frameGrid, intersects, type Frame, type Rect } from './grid.ts'
import { hitTest, type Point } from './hit-test.ts'
import { NUDGE, NUDGE_FAR, shortcutFor, type ShortcutAction } from './shortcuts.ts'
import {
  angleOf, boundsOf, carry, centreOf, cornersOf, handleAt, HANDLES, normalAngle, resize as resizeBox, round, scaleWithin, snapAngle, turn, type Box, type Handle,
} from './transform.ts'

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
  /**
   * Loading steps, then once the design is open its save state (#37): Saving while the sync server
   * has not yet got every edit, Saved once it has, Offline (kept on this device) without it.
   */
  onStatus?: (status: string) => void
  /** Called with the zoom (1 is 100%) whenever it changes. */
  onZoom?: (zoom: number) => void
  /** Aborting it while the editor is still connecting stops it, freeing what it made. */
  signal?: AbortSignal
}

/** A layer as one frame shows it: selection, dragging and typing all happen in one frame. */
interface Picked { id: string; frame: string }
/** The selected layers, all in one frame, in the order they were picked. */
interface Selection { ids: string[]; frame: string }
/** The caret is anchored in the text, so edits arriving from other tabs carry it along. */
interface Editing extends Picked { caret: TextAnchor; endGesture: () => void }
/** What the select tool does with a drag on empty canvas and the hand tool with any drag. */
export type Tool = 'select' | 'hand'

/** Where the design's edits are, once it is open. */
export type SaveState = 'Saved' | 'Saving' | 'Offline'
export const SAVE_STATES: readonly string[] = ['Saved', 'Saving', 'Offline'] satisfies SaveState[]

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
/** Room around the frames when the focus view fits them, past the chip over the stage. */
const FOCUS_PADDING = 104
/** How long the connection can be gone before the save state reads Offline. */
const OFFLINE_AFTER_MS = 1500

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
  // The design kept in this browser (#37): a crash, a closed tab or a reload without a connection
  // loses nothing, and edits made offline merge when the sync server is back.
  const local = new IndexeddbPersistence(`razzlr-design-${designId}`, doc)
  const provider = new HocuspocusProvider({
    url: syncUrl, name: designId, document: doc, token: options.syncToken,
    onAuthenticationFailed: ({ reason }) => status(`Error: the sync server refused this design (${reason})`),
  })
  try {
    await local.whenSynced
    // A copy on this device opens at once, even offline; a first visit waits for the sync server.
    const kept = doc.store.clients.size > 0
    await new Promise<void>((resolve, reject) => {
      const stop = () => reject(new Error('stopped while connecting'))
      if (options.signal?.aborted) stop()
      options.signal?.addEventListener('abort', stop)
      if (kept || provider.synced) resolve()
      else provider.on('synced', () => resolve())
    })
    // The first frame and any export need every image the design names, so they load first;
    // offline, a kept design opens without them and they load when they can.
    const images = await loadImages(imageAssetIds(readDesign(doc)), options).catch((error: unknown) => {
      if (kept) return {}
      throw error
    })
    return live(ck, cache, { ...resourceBytes, images }, doc, provider, local, options)
  } catch (error) {
    provider.destroy()
    await local.destroy()
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
  doc: Y.Doc, provider: HocuspocusProvider, local: IndexeddbPersistence, options: EditorOptions,
) {
  const { canvas, overlay } = options
  let resourceBytes = firstBytes
  let resources = cache.resources(resourceBytes)
  const status = options.onStatus ?? (() => {})

  let connection = provider.configuration.websocketProvider.status
  let shown: SaveState | null = null
  let offlineTimer = 0
  /**
   * Shows where the edits are: on the sync server, on their way, or only on this device. A lost
   * connection reads Offline after a moment, so a reconnect that takes a blink doesn't flash it.
   */
  const saveState = () => {
    let next: SaveState
    if (connection === WebSocketStatus.Connected) {
      clearTimeout(offlineTimer)
      offlineTimer = 0
      next = provider.hasUnsyncedChanges ? 'Saving' : 'Saved'
    } else if (!navigator.onLine) {
      next = 'Offline'
    } else {
      if (!offlineTimer && shown !== 'Offline') {
        offlineTimer = window.setTimeout(() => {
          offlineTimer = 0
          if (connection !== WebSocketStatus.Connected) show('Offline')
        }, OFFLINE_AFTER_MS)
      }
      next = shown === 'Offline' ? 'Offline' : 'Saving'
    }
    show(next)
  }
  const show = (next: SaveState) => {
    if (next === shown) return
    shown = next
    status(next)
  }
  const onConnection = ({ status: next }: { status: WebSocketStatus }) => {
    connection = next
    if (shown) saveState()
  }
  const onUnsynced = () => {
    if (shown) saveState()
  }
  provider.on('status', onConnection)
  provider.on('unsyncedChanges', onUnsynced)

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
  // The browser knows first when the network goes: drop the socket rather than wait for it to time
  // out, and connect again as soon as the network is back.
  window.addEventListener('offline', () => {
    provider.disconnect()
    onConnection({ status: WebSocketStatus.Disconnected })
  }, on)
  window.addEventListener('online', () => void provider.connect(), on)

  let design: Design = session.design()
  /** The one format the focus view shows, or null for every format. */
  let focused: string | null = null
  let grid = frameGrid(design, focused)
  let camera: Camera = { x: 0, y: 0, zoom: 1 }
  let tool: Tool = 'select'
  let selection: Selection | null = null
  /** The group or frame double-clicked into: a click then picks what is directly inside it (#41). */
  let entered: string | null = null
  /** The layer under the pointer, outlined while nothing is being dragged. */
  let hovered: Picked | null = null
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

  /**
   * A layer's box in one frame, read from the document: the base with the format's overrides.
   * Hidden layers have one too, so they move with a group and stay selected.
   */
  function boxIn(frame: Frame, id: string, from: Design = session.design()): Box | null {
    const node = from.nodes[id]
    if (!node) return null
    const p = { ...node.props, ...from.overrides[scope(frame)]?.[id] } as { x: number; y: number; width: number; height: number; rotation?: number }
    return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0 }
  }
  /** The groups and frames a layer is inside, outermost first, as boxes in a frame. */
  function containersOf(frame: Frame, parentId: string | undefined, from: Design = session.design()): Box[] {
    const boxes: Box[] = []
    for (let up = parentId; up && from.nodes[up]; up = from.nodes[up]?.parentId) {
      const box = boxIn(frame, up, from)
      if (box) boxes.unshift(box)
    }
    return boxes
  }
  /** A box as drawn inside containers: each one turns it about the container's centre. */
  function drawnFrom(box: Box, around: Box[]): Box {
    let c = centreOf(box)
    let rotation = box.rotation
    for (const outer of [...around].reverse()) {
      c = turn(c, centreOf(outer), outer.rotation)
      rotation += outer.rotation
    }
    return { ...box, x: c.x - box.width / 2, y: c.y - box.height / 2, rotation: normalAngle(rotation) }
  }
  /** A point on the page as layers inside containers see it, before the containers turn them. */
  function localTo(p: Point, around: Box[]): Point {
    let q = p
    for (const outer of around) q = turn(q, centreOf(outer), -outer.rotation)
    return q
  }
  /** A layer's box as it is drawn in a frame. */
  function drawnBoxOf(frame: Frame, id: string, from: Design = session.design()) {
    const box = boxIn(frame, id, from)
    return box && drawnFrom(box, containersOf(frame, from.nodes[id]?.parentId, from))
  }
  /** Locked in place layers can't be picked on the stage: a click goes to what lies beneath. */
  const pickable = (layer: SceneLayer) => !design.nodes[layer.id]?.lock?.move
  /** Drops selected layers that are gone, and the selection once none are left or its frame is. */
  function keepSelection() {
    if (!selection) return
    const ids = selection.ids.filter((id) => design.nodes[id])
    selection = ids.length > 0 && frameOf(selection.frame) ? { ...selection, ids } : null
    if (entered && !design.nodes[entered]) entered = null
  }
  /** Selected layers that aren't inside another selected layer: the ones a transform moves. */
  function roots(from: Design = session.design()) {
    const ids = selection?.ids ?? []
    const inside = (id: string) => {
      for (let up = from.nodes[id]?.parentId; up && from.nodes[up]; up = from.nodes[up]?.parentId) if (ids.includes(up)) return true
      return false
    }
    return ids.filter((id) => from.nodes[id] && !inside(id))
  }
  /**
   * The box the handles go on: a single layer's own, turned with it, or the unturned box around
   * several. `box` is as the layers inside their containers see it, which gestures work in;
   * `drawn` is where it is on the page once the containers turn it; `around` are the containers.
   */
  function selectionBox(): { frame: Frame; box: Box; drawn: Box; around: Box[] } | null {
    const frame = selection && frameOf(selection.frame)
    if (!frame || !selection) return null
    const now = session.design()
    const boxes = selection.ids.map((id) => boxIn(frame, id, now)).filter((b): b is Box => b !== null)
    if (boxes.length === 0) return null
    const box = boxes.length === 1 ? boxes[0] as Box : boundsOf(boxes)
    const around = containersOf(frame, now.nodes[selection.ids[0] ?? '']?.parentId, now)
    return { frame, box, drawn: drawnFrom(box, around), around }
  }
  /**
   * What a press on a layer picks: a selected layer it is in, so the selection moves whole; inside
   * the group or frame double-clicked into, what is directly in it; or else the layer on the page
   * that holds it, so a click on a group's child picks the group.
   */
  function target(hitId: string, frame: string) {
    const chain: string[] = []
    for (let up: string | undefined = hitId; up && design.nodes[up]; up = design.nodes[up]?.parentId) chain.push(up)
    const selected = selection?.frame === frame ? chain.find((id) => selection?.ids.includes(id)) : undefined
    const at = entered ? chain.indexOf(entered) : -1
    return selected ?? (at > 0 ? chain[at - 1] : chain.at(-1)) ?? hitId
  }
  /** Whether a layer is inside the entered group or frame, not the container itself. */
  function insideEntered(id: string) {
    for (let up = design.nodes[id]?.parentId; up && design.nodes[up]; up = design.nodes[up]?.parentId) if (up === entered) return true
    return false
  }
  function select(ids: string[], frame: string) {
    selection = ids.length > 0 ? { ids, frame } : null
    drawOverlay()
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
    if (selection?.frame === frame.key || editing?.frame === frame.key) label.dataset.active = ''
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

  /** Room the tool dock takes along the bottom of the stage, which the size label stays out of. */
  const SIZE_CLEARANCE = 72
  /** A box on the overlay, turned as the layer is. */
  function outline(className: string, frame: Frame, box: Box) {
    const el = document.createElement('div')
    el.className = className
    placeBox(el, frame, box)
    if (box.rotation) el.style.transform = `rotate(${box.rotation}deg)`
    return el
  }

  /** Each selected layer's outline, then the box with its handles and the size under it. */
  function selectionParts() {
    const outer = selectionBox()
    if (!outer || !selection) return []
    const { frame, drawn: box } = outer
    const parts: HTMLElement[] = []
    const several = selection.ids.length > 1
    if (several) {
      for (const id of selection.ids) {
        const b = drawnBoxOf(frame, id, design)
        if (!b) continue
        const member = outline('selection-member', frame, b)
        member.dataset.layer = id
        parts.push(member)
      }
    }
    const el = outline('selection', frame, box)
    el.dataset.frame = frame.key
    el.dataset.count = String(selection.ids.length)
    if (!several) el.dataset.layer = selection.ids[0]
    // Handles only once the box is big enough on screen to grab them apart.
    if (!editing && Math.min(box.width, box.height) * camera.zoom >= 2 * HANDLE_SIZE) {
      for (const h of HANDLES) {
        const handle = document.createElement('div')
        handle.className = 'handle'
        handle.dataset.handle = h
        const at = handleAt(h)
        Object.assign(handle.style, { left: `${at.x * 100}%`, top: `${at.y * 100}%` })
        el.append(handle)
      }
    }
    parts.push(el)
    if (!editing) {
      const corners = cornersOf(box).map((p) => toScreen(camera, { x: frame.x + p.x, y: frame.y + p.y }))
      const size = document.createElement('div')
      size.className = 'selection-size'
      size.textContent = `${round(box.width, 0)} × ${round(box.height, 0)}`
      // Under the box, or over it when the tool dock along the stage's bottom would cover it.
      const below = Math.max(...corners.map((c) => c.y)) + 8
      const top = below + 24 > viewport.height - SIZE_CLEARANCE ? Math.min(...corners.map((c) => c.y)) - 26 : below
      Object.assign(size.style, { left: px((Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2), top: px(top) })
      parts.push(size)
    }
    return parts
  }

  let drawnFrames: Frame[] = []
  function drawOverlay() {
    const parts: HTMLElement[] = []
    for (const frame of drawnFrames) {
      const label = frameLabel(frame, drawnFrames)
      if (label) parts.push(label)
    }
    const enteredFrame = entered && frameOf(selection?.frame)
    const enteredBox = enteredFrame && entered && drawnBoxOf(enteredFrame, entered, design)
    if (enteredFrame && enteredBox) parts.push(outline('entered', enteredFrame, enteredBox))
    const hover = !gesture && hovered && !selection?.ids.includes(hovered.id) ? hovered : null
    const hoverFrame = hover && frameOf(hover.frame)
    const hoverBox = hoverFrame && hover && drawnBoxOf(hoverFrame, hover.id, design)
    if (hoverFrame && hoverBox) parts.push(outline('hover', hoverFrame, hoverBox))
    parts.push(...selectionParts())
    if (gesture?.kind === 'marquee') {
      const marquee = document.createElement('div')
      marquee.className = 'marquee'
      const from = toScreen(camera, gesture.from)
      const to = toScreen(camera, gesture.to)
      Object.assign(marquee.style, {
        left: px(Math.min(from.x, to.x)), top: px(Math.min(from.y, to.y)), width: px(Math.abs(to.x - from.x)), height: px(Math.abs(to.y - from.y)),
      })
      parts.push(marquee)
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
    if (focused && !design.formats[focused]) focused = null
    grid = frameGrid(design, focused)
    keepSelection()
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
    rehover()
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
      }, (error: unknown) => {
        // Offline, an image waits for the connection; the next redraw asks for it again.
        if (connection !== WebSocketStatus.Connected) return
        status(`Error: an image did not load (${error instanceof Error ? error.message : String(error)})`)
      })
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
    // The focus view's chip sits over the stage's top edge: leave it room above the frame's label.
    setCamera(fit(grid.bounds, viewport, focused ? FOCUS_PADDING : undefined))
  }
  function fitFrame(frame: Frame | undefined) {
    if (frame) setCamera(fit(frame, viewport))
  }
  function fitSelection() {
    const outer = selectionBox()
    if (!outer) return fitAll()
    const { frame, box } = outer
    const b = boundsOf([box])
    setCamera(fit({ x: frame.x + b.x, y: frame.y + b.y, width: b.width, height: b.height }, viewport))
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

  /** What a drag on the stage is doing, from pointer down to up. */
  type Gesture =
    | { kind: 'move'; frame: Frame; around: Box[]; from: Point; roots: string[]; boxes: Map<string, Box>; end: () => void }
    | { kind: 'resize'; frame: Frame; around: Box[]; handle: Handle; outer: Box; grab: Point; roots: string[]; boxes: Map<string, Box>; end: () => void }
    | { kind: 'rotate'; frame: Frame; around: Box[]; outer: Box; from: number; roots: string[]; boxes: Map<string, Box>; end: () => void }
    | { kind: 'marquee'; from: Point; to: Point; base: string[]; baseFrame: string | null }
  let gesture: Gesture | null = null
  /** A click on one of several selected layers selects it alone, unless the pointer moves first. */
  let clickedAlone: string | null = null
  let pan: { from: Point; camera: Camera } | null = null
  let spaceHeld = false
  const panning = () => tool === 'hand' || spaceHeld

  /** The boxes a transform changes: each root and every layer under it, as they are now. */
  function startBoxes(frame: Frame, ids: string[]) {
    const now = session.design()
    const boxes = new Map<string, Box>()
    const add = (id: string) => {
      const box = boxIn(frame, id, now)
      if (box) boxes.set(id, box)
      for (const [child] of childrenOf(now, id)) add(child)
    }
    for (const id of ids) add(id)
    return boxes
  }
  /** What each gesture has written so far, by its start boxes: `<id>|<property>`. */
  const written = new WeakMap<Map<string, Box>, Set<string>>()
  /**
   * Writes new boxes as this format's overrides: the properties the gesture changes from where it
   * started, including one it changed and has now put back. The rest is left to other tabs.
   */
  function writeBoxes(frame: Frame, start: Map<string, Box>, next: Map<string, Box>) {
    const now = session.design()
    const wrote = written.get(start) ?? new Set<string>()
    written.set(start, wrote)
    for (const [id, box] of next) {
      const was = start.get(id)
      const current = boxIn(frame, id, now)
      const patch: Partial<Box> = {}
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
        if ((box[key] !== was?.[key] || wrote.has(`${id}|${key}`)) && box[key] !== current?.[key]) patch[key] = box[key]
      }
      for (const key of Object.keys(patch)) wrote.add(`${id}|${key}`)
      // Another tab may delete or lock a layer mid-drag; the drag then just leaves it be.
      if (Object.keys(patch).length > 0) runQuietly(() => session.run('node.update', { ids: [id], scope: scope(frame), patch }))
    }
  }
  /** Every layer under `id` in the document, nearest first. */
  const under = (id: string, from: Design): string[] => childrenOf(from, id).flatMap(([child]) => [child, ...under(child, from)])

  function moveTo(g: Extract<Gesture, { kind: 'move' }>, p: Point, axisLock: boolean) {
    let dx = p.x - g.from.x
    let dy = p.y - g.from.y
    // Shift keeps a move to one axis, whichever it has gone further along.
    if (axisLock) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    const next = new Map([...g.boxes].map(([id, b]) => [id, { ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) }]))
    writeBoxes(g.frame, g.boxes, next)
  }

  function resizeTo(g: Extract<Gesture, { kind: 'resize' }>, p: Point, keepRatio: boolean, fromCentre: boolean) {
    // The handle follows the pointer from where it was grabbed, so a press off its centre doesn't jump.
    const at = handleAt(g.handle)
    const handle = turn({ x: g.outer.x + at.x * g.outer.width, y: g.outer.y + at.y * g.outer.height }, centreOf(g.outer), g.outer.rotation)
    const outer = resizeBox(g.outer, g.handle, { x: handle.x + p.x - g.grab.x, y: handle.y + p.y - g.grab.y }, { keepRatio, fromCentre })
    const next = new Map<string, Box>()
    const now = session.design()
    for (const root of g.roots) {
      const was = g.boxes.get(root)
      if (!was) continue
      const box = g.roots.length === 1 ? outer : scaleWithin(was, g.outer, outer)
      next.set(root, box)
      // Layers inside a group or frame keep their place in it.
      for (const id of under(root, now)) {
        const inner = g.boxes.get(id)
        if (inner) next.set(id, carry(inner, was, box))
      }
    }
    writeBoxes(g.frame, g.boxes, new Map([...next].map(([id, b]) => [id, { ...b, x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) }])))
  }

  function rotateTo(g: Extract<Gesture, { kind: 'rotate' }>, p: Point, snap: boolean) {
    const centre = centreOf(g.outer)
    const turned = angleOf(p, centre) - g.from
    const next = new Map<string, Box>()
    const now = session.design()
    if (g.roots.length === 1) {
      // One layer: its own angle snaps with shift. What is inside it turns with it as it is drawn.
      const root = g.roots[0] as string
      const angle = g.outer.rotation + turned
      next.set(root, { ...g.outer, rotation: round(normalAngle(snap ? snapAngle(angle) : angle)) })
    } else {
      // Several: each turns about the selection's centre, by an angle that snaps with shift.
      const delta = snap ? snapAngle(turned) : turned
      for (const root of g.roots) {
        const was = g.boxes.get(root)
        if (!was) continue
        const c = centreOf(was)
        const moved = turn(c, centre, delta)
        const dx = moved.x - c.x
        const dy = moved.y - c.y
        next.set(root, { ...was, x: round(was.x + dx), y: round(was.y + dy), rotation: round(normalAngle(was.rotation + delta)) })
        for (const id of under(root, now)) {
          const inner = g.boxes.get(id)
          if (inner) next.set(id, { ...inner, x: round(inner.x + dx), y: round(inner.y + dy) })
        }
      }
    }
    writeBoxes(g.frame, g.boxes, next)
  }

  /** Top-level layers the marquee touches on the page it covers, with what was selected before. */
  function marqueeSelect(g: Extract<Gesture, { kind: 'marquee' }>) {
    const rect = { x: Math.min(g.from.x, g.to.x), y: Math.min(g.from.y, g.to.y), width: Math.abs(g.to.x - g.from.x), height: Math.abs(g.to.y - g.from.y) }
    const frame = frameAt(grid.frames, g.from) ?? grid.frames.find((f) => intersects(f, rect))
    if (!frame) return
    const local = { x: rect.x - frame.x, y: rect.y - frame.y, width: rect.width, height: rect.height }
    const hits = cached(frame).scene.layers
      .filter((layer) => pickable(layer) && intersects(boundsOf([{ ...layer.props }]), local))
      .map((layer) => layer.id)
    const base = g.baseFrame === frame.key ? g.base : []
    selection = hits.length + base.length > 0 ? { frame: frame.key, ids: [...base, ...hits.filter((id) => !base.includes(id))] } : null
  }

  /** Screen size of a handle, and how far from it a press still grabs it. */
  const HANDLE_SIZE = 8
  const HANDLE_REACH = 7
  /** How far outside a corner a press turns the selection. */
  const ROTATE_REACH = 24

  /** The handle under a screen point: one to resize by, or the zone outside a corner to turn by. */
  function handleUnder(screen: Point): { kind: 'resize'; handle: Handle } | { kind: 'rotate'; corner: number } | null {
    const outer = selectionBox()
    if (!outer || editing) return null
    const { frame, drawn: box } = outer
    const onScreen = (p: Point) => toScreen(camera, { x: frame.x + p.x, y: frame.y + p.y })
    const c = centreOf(box)
    const dist = (p: Point) => Math.hypot(p.x - screen.x, p.y - screen.y)
    if (Math.min(box.width, box.height) * camera.zoom >= 2 * HANDLE_SIZE) {
      for (const handle of HANDLES) {
        const at = handleAt(handle)
        if (dist(onScreen(turn({ x: box.x + at.x * box.width, y: box.y + at.y * box.height }, c, box.rotation))) <= HANDLE_REACH) return { kind: 'resize', handle }
      }
    }
    const world = toWorld(camera, screen)
    const local = turn({ x: world.x - frame.x, y: world.y - frame.y }, c, -box.rotation)
    const inside = local.x >= box.x && local.x <= box.x + box.width && local.y >= box.y && local.y <= box.y + box.height
    if (inside) return null
    const corner = cornersOf(box).findIndex((p) => dist(onScreen(p)) <= ROTATE_REACH)
    return corner === -1 ? null : { kind: 'rotate', corner }
  }

  /** Resize cursors point along the handle's direction as the box is turned. */
  const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
  const HANDLE_ANGLE: Record<Handle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }
  const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 15a7 7 0 1 1 3 4.7" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 15a7 7 0 1 1 3 4.7" fill="none" stroke="black" stroke-width="1.75" stroke-linecap="round"/><path d="M3 12l3 3.5 3.5-3" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12l3 3.5 3.5-3" fill="none" stroke="black" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 12 12, crosshair`
  let hoverCursor = ''
  const showCursor = () => {
    canvas.style.cursor = pan ? 'grabbing' : panning() ? 'grab' : hoverCursor
  }
  function cursorFor(screen: Point) {
    if (gesture?.kind === 'resize' || gesture?.kind === 'rotate') return
    const under = handleUnder(screen)
    const rotation = selectionBox()?.drawn.rotation ?? 0
    hoverCursor = !under ? '' : under.kind === 'rotate' ? ROTATE_CURSOR
      : RESIZE_CURSORS[Math.round(((((HANDLE_ANGLE[under.handle] + rotation) % 180) + 180) % 180) / 45) % 4] ?? ''
    showCursor()
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
    const screen = screenOf(e)
    const at = pointIn(e)
    const deepest = at && hitTest(cached(at.frame).scene.layers, at.p, pickable)
    if (at && editing && deepest?.id === editing.id && editing.frame === at.frame.key) {
      editing.caret = textAnchor(doc, editing.id, caretFromPoint(at.p))
      drawOverlay()
      return
    }
    stopEditing()
    clickedAlone = null
    const grabbed = handleUnder(screen)
    const outer = selectionBox()
    if (grabbed && outer && selection) {
      canvas.setPointerCapture(e.pointerId)
      const ids = roots()
      const boxes = startBoxes(outer.frame, ids)
      const end = session.beginGesture()
      const world = toWorld(camera, screen)
      const { around } = outer
      const grab = localTo({ x: world.x - outer.frame.x, y: world.y - outer.frame.y }, around)
      if (grabbed.kind === 'resize') gesture = { kind: 'resize', frame: outer.frame, around, handle: grabbed.handle, outer: outer.box, grab, roots: ids, boxes, end }
      else gesture = { kind: 'rotate', frame: outer.frame, around, outer: outer.box, from: angleOf(grab, centreOf(outer.box)), roots: ids, boxes, end }
      drawOverlay()
      return
    }
    const inSelection = (id: string) => selection?.frame === at?.frame.key && selection?.ids.includes(id)
    // Inside the box around several selected layers, a press moves them all, gaps included.
    const inner = at && outer && localTo(at.p, outer.around)
    const inOuter = inner && outer && selection && selection.ids.length > 1 && outer.frame.key === at.frame.key
      && inner.x >= outer.box.x && inner.x <= outer.box.x + outer.box.width && inner.y >= outer.box.y && inner.y <= outer.box.y + outer.box.height
    // A press outside the group or frame double-clicked into leaves it.
    if (entered && !inOuter && !(deepest && insideEntered(deepest.id))) entered = null
    const hit = at && deepest ? { id: target(deepest.id, at.frame.key) } : null
    if (at && hit) {
      if (e.shiftKey) {
        // Shift adds a layer to the selection, or takes it out again.
        if (inSelection(hit.id) && selection) {
          select(selection.ids.filter((id) => id !== hit.id), selection.frame)
          return
        }
        select(selection?.frame === at.frame.key ? [...selection.ids, hit.id] : [hit.id], at.frame.key)
      } else if (inSelection(hit.id)) {
        if ((selection?.ids.length ?? 0) > 1) clickedAlone = hit.id
      } else {
        select([hit.id], at.frame.key)
      }
    } else if (!inOuter) {
      // Empty canvas: a marquee, adding to the selection with shift.
      canvas.setPointerCapture(e.pointerId)
      const from = toWorld(camera, screen)
      const base = e.shiftKey ? selection?.ids ?? [] : []
      const baseFrame = e.shiftKey ? selection?.frame ?? null : null
      if (!e.shiftKey) selection = null
      entered = null
      gesture = { kind: 'marquee', from, to: from, base, baseFrame }
      drawOverlay()
      return
    }
    const frame = at && frameOf(selection?.frame)
    const around = selectionBox()?.around ?? []
    if (!at || !frame) return
    canvas.setPointerCapture(e.pointerId)
    const ids = roots()
    gesture = { kind: 'move', frame, around, from: localTo(at.p, around), roots: ids, boxes: startBoxes(frame, ids), end: session.beginGesture() }
    drawOverlay()
  }, on)

  /** Where the pointer last was over the stage, so the hover outline follows edits under it. */
  let pointer: MouseEvent | null = null
  function rehover() {
    const at = pointer && !gesture && !panning() ? pointIn(pointer) : null
    const hit = at && hitTest(cached(at.frame).scene.layers, at.p, pickable)
    const next = at && hit ? { id: target(hit.id, at.frame.key), frame: at.frame.key } : null
    const changed = next?.id !== hovered?.id || next?.frame !== hovered?.frame
    hovered = next
    return changed
  }

  canvas.addEventListener('pointermove', (e) => {
    pointer = e
    if (pan) {
      setCamera({ ...pan.camera, x: pan.camera.x + e.clientX - pan.from.x, y: pan.camera.y + e.clientY - pan.from.y })
      return
    }
    const screen = screenOf(e)
    if (!gesture) {
      // Hovering: outline the layer under the pointer and show what a press on a handle would do.
      cursorFor(screen)
      if (rehover()) drawOverlay()
      return
    }
    const world = toWorld(camera, screen)
    if (gesture.kind === 'marquee') {
      gesture.to = world
      marqueeSelect(gesture)
      drawOverlay()
      return
    }
    clickedAlone = null
    const p = localTo({ x: world.x - gesture.frame.x, y: world.y - gesture.frame.y }, gesture.around)
    if (gesture.kind === 'move') moveTo(gesture, p, e.shiftKey)
    else if (gesture.kind === 'resize') resizeTo(gesture, p, e.shiftKey, e.altKey)
    else rotateTo(gesture, p, e.shiftKey)
  }, on)

  const endDrag = () => {
    if (gesture && gesture.kind !== 'marquee') {
      hug(gesture.roots)
      gesture.end()
    }
    if (clickedAlone && selection) select([clickedAlone], selection.frame)
    clickedAlone = null
    gesture = null
    pan = null
    showCursor()
    drawOverlay()
  }
  canvas.addEventListener('pointerup', endDrag, on)
  canvas.addEventListener('pointercancel', endDrag, on)
  canvas.addEventListener('pointerleave', () => {
    pointer = null
    if (!hovered) return
    hovered = null
    drawOverlay()
  }, on)
  canvas.addEventListener('dblclick', (e) => {
    if (panning()) return
    const at = pointIn(e)
    const hit = at && hitTest(cached(at.frame).scene.layers, at.p, pickable)
    if (!at || !hit) return
    const picked = target(hit.id, at.frame.key)
    const container = design.nodes[picked]
    if (picked !== hit.id && (container?.type === 'group' || container?.type === 'frame')) {
      // Into the group or frame: what is directly inside it under the pointer gets picked.
      stopEditing()
      entered = picked
      selection = null
      select([target(hit.id, at.frame.key)], at.frame.key)
      return
    }
    if (hit.type !== 'text' || design.nodes[hit.id]?.lock?.content) return
    stopEditing()
    selection = { ids: [hit.id], frame: at.frame.key }
    editing = { id: hit.id, frame: at.frame.key, caret: textAnchor(doc, hit.id, 0), endGesture: session.beginGesture() }
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

  /** Groups fit what they hold again after a change inside them, in the same undo step (#41). */
  function hug(ids: string[]) {
    const now = session.design()
    const live = ids.filter((id) => now.nodes[id])
    if (live.length > 0) runQuietly(() => session.run('node.hug', { ids: live }))
  }

  /** Moves the selection by whole pixels in its format, one undo step per press. */
  function nudge(dx: number, dy: number) {
    const frame = selection && frameOf(selection.frame)
    if (!frame) return
    const ids = roots()
    const boxes = startBoxes(frame, ids)
    // Arrows move along the page as drawn, also inside a turned group.
    const around = selectionBox()?.around ?? []
    const step = localTo({ x: dx, y: dy }, around.map((b) => ({ ...b, x: -b.width / 2, y: -b.height / 2 })))
    session.gesture(() => {
      writeBoxes(frame, boxes, new Map([...boxes].map(([id, b]) => [id, { ...b, x: round(b.x + step.x), y: round(b.y + step.y) }])))
      hug(ids)
    })
  }

  /** The top-level layers of the selection's page, or the first page's, that can be picked. */
  function selectAll() {
    const frame = frameOf(selection?.frame) ?? frameOf(`${firstPage()}/${design.meta.primaryFormatId}`) ?? grid.frames[0]
    if (!frame) return
    select(cached(frame).scene.layers.filter(pickable).map((layer) => layer.id), frame.key)
  }

  /**
   * Does what a shortcut names. Returns whether there was anything to do it to; the keys that act
   * on the selection do nothing without one.
   */
  function perform(action: ShortcutAction): boolean {
    const view: Partial<Record<ShortcutAction, () => void>> = {
      undo: () => session.undo(),
      redo: () => session.redo(),
      zoomToFit: fitAll,
      zoomToSelection: fitSelection,
      zoomTo100: () => zoomTo(1),
      zoomIn: () => zoomTo(camera.zoom * ZOOM_STEP),
      zoomOut: () => zoomTo(camera.zoom / ZOOM_STEP),
      selectAll,
    }
    const viewAction = view[action]
    if (viewAction) {
      if (action === 'undo' || action === 'redo') {
        endDrag()
        stopEditing()
      }
      viewAction()
      return true
    }
    const frame = selection && frameOf(selection.frame)
    if (!selection || !frame) return false
    const ids = roots()
    const nodes = session.design().nodes
    const far = action.endsWith('Far') ? NUDGE_FAR : NUDGE
    switch (action) {
      case 'deselect': {
        // Out of a group or frame one level at a time: it gets selected, then the page.
        const up = entered
        const parent = up ? design.nodes[up]?.parentId : undefined
        entered = parent && design.nodes[parent] ? parent : null
        select(up ? [up] : [], frame.key)
        break
      }
      case 'delete': {
        const parents = ids.map((id) => nodes[id]?.parentId ?? '').filter((id) => nodes[id])
        if (runQuietly(() => session.gesture(() => {
          session.run('node.delete', { ids })
          hug(parents)
        }))) select([], frame.key)
        break
      }
      case 'group': {
        let group = ''
        if (runQuietly(() => { group = session.run('node.group', { ids }) })) select([group], frame.key)
        break
      }
      case 'ungroup': {
        const groups = ids.filter((id) => nodes[id]?.type === 'group')
        if (groups.length === 0) return false
        let freed: string[] = []
        if (runQuietly(() => { freed = session.run('node.ungroup', { ids: groups }) })) {
          select([...ids.filter((id) => !groups.includes(id)), ...freed], frame.key)
        }
        break
      }
      case 'duplicate': {
        let copies: string[] = []
        if (runQuietly(() => { copies = session.run('node.duplicate', { ids }) })) select(copies, frame.key)
        break
      }
      case 'bringForward': runQuietly(() => session.run('node.reorder', { ids, to: 'forward' }))
        break
      case 'sendBackward': runQuietly(() => session.run('node.reorder', { ids, to: 'backward' }))
        break
      case 'bringToFront': runQuietly(() => session.run('node.reorder', { ids, to: 'front' }))
        break
      case 'sendToBack': runQuietly(() => session.run('node.reorder', { ids, to: 'back' }))
        break
      case 'lock': {
        // Locks every flag, or unlocks them all when every selected layer is already locked.
        const locked = selection.ids.every((id) => LOCK_FLAGS.every((flag) => nodes[id]?.lock?.[flag]))
        runQuietly(() => session.run('node.lock', { ids: selection?.ids ?? [], lock: Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, !locked])) }))
        break
      }
      case 'hide': {
        // Hidden in this format only, like a move; the layer stays selected so it can be shown again.
        const shown = selection.ids.some((id) => visibleIn(frame, id))
        runQuietly(() => session.run('node.update', { ids: selection?.ids ?? [], scope: scope(frame), patch: { visible: !shown } }))
        break
      }
      case 'nudgeLeft': case 'nudgeLeftFar': nudge(-far, 0)
        break
      case 'nudgeRight': case 'nudgeRightFar': nudge(far, 0)
        break
      case 'nudgeUp': case 'nudgeUpFar': nudge(0, -far)
        break
      case 'nudgeDown': case 'nudgeDownFar': nudge(0, far)
        break
      default: return false
    }
    drawOverlay()
    return true
  }
  const visibleIn = (frame: Frame, id: string) => {
    const now = session.design()
    const value = now.overrides[scope(frame)]?.[id]?.visible ?? now.nodes[id]?.props.visible
    return value !== false
  }

  function onKey(e: KeyboardEvent) {
    if (inField(e.target)) return
    const action = shortcutFor(e)
    if (action === 'undo' || action === 'redo') {
      e.preventDefault()
      perform(action)
      return
    }
    if (!editing) {
      if (e.code === 'Space' && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (!spaceHeld) {
          spaceHeld = true
          showCursor()
        }
      } else if (action && perform(action)) {
        e.preventDefault()
      }
      return
    }
    const mod = e.metaKey || e.ctrlKey
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
  saveState()

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
    /** The first selected layer, or null. */
    selected: () => selection?.ids[0] ?? null,
    /** Every selected layer, in the order they were picked. */
    selection: () => [...(selection?.ids ?? [])],
    /** The frame the selection is in, as `<pageId>/<formatId>`. */
    selectedFrame: () => selection?.frame ?? null,
    /** Selects layers in one frame, the first page in the primary format by default; none clears it. */
    select(ids: string[], pageId?: string, formatId?: string) {
      stopEditing()
      select(ids.filter((id) => session.design().nodes[id]), defaultFrame(pageId, formatId).key)
    },
    /** Does what a shortcut does, as if its key was pressed on the stage. */
    perform,
    frames: () => frameGrid(session.design(), focused).frames,
    /** The format the focus view shows alone, or null when every format shows. */
    focused: () => focused,
    /** Shows one format alone, fitted, or every format again with null. */
    focus(formatId: string | null) {
      focused = formatId && design.formats[formatId] ? formatId : null
      grid = frameGrid(design, focused)
      if (selection && !frameOf(selection.frame)) selection = null
      if (editing && !frameOf(editing.frame)) stopEditing()
      fitAll()
    },
    camera: () => camera,
    viewport: () => viewport,
    setCamera,
    zoomTo,
    zoomIn: () => zoomTo(camera.zoom * ZOOM_STEP),
    zoomOut: () => zoomTo(camera.zoom / ZOOM_STEP),
    fitAll,
    fitSelection,
    fitFrame: (pageId: string, formatId: string) => fitFrame(defaultFrame(pageId, formatId)),
    /** Brings one page's row into view: every format of that page, fitted. */
    fitPage(pageId: string) {
      const row = grid.frames.filter((f) => f.pageId === pageId)
      const first = row[0]
      if (!first) return
      const right = Math.max(...row.map((f) => f.x + f.width))
      const bottom = Math.max(...row.map((f) => f.y + f.height))
      setCamera(fit({ x: first.x, y: first.y, width: right - first.x, height: bottom - first.y }, viewport, focused ? FOCUS_PADDING : undefined))
    },
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
      clearTimeout(offlineTimer)
      provider.off('status', onConnection)
      provider.off('unsyncedChanges', onUnsynced)
      provider.destroy()
      void local.destroy()
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
