// The editor: one infinite canvas per design with every page in every format as a frame (#36),
// click to select, drag to move, typing into text, pan and zoom. It has no framework in it; the
// page only hands it a canvas and an overlay the size of the stage.
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { anchorOffset, childrenOf, CommandError, openSession, readDesign, textAnchor, type Session, type TextAnchor } from '@razzlr/doc'
import { FALLBACK_FAMILIES, FONT_FACES } from '@razzlr/fonts'
import {
  caretAt, caretPosition, drawPage, layerPictures, paragraphCache, selectionBoxes, render, renderDesign, resourceCache, sceneMemo, textMeasure, type MeasureText, type ResourceCache, type Resources, type Scene, type SceneLayer,
} from '@razzlr/renderer'
import {
  canHold, fontFamilies, imageAssetIds, isContainer, LAYER_CLIPBOARD_TYPE, LayerClipboard, LOCK_FLAGS, SCHEMA_VERSION, type Design, type ExportRequestInput, type Layer, type LayerTree, type Paint,
} from '@razzlr/schema'
import type { CanvasKit, GrDirectContext, Image, SkPicture, Surface } from 'canvaskit-wasm'
import canvasKitModule from 'canvaskit-wasm/full'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { fit, toScreen, toWorld, visibleRect, zoomAt, type Camera, type Viewport } from './camera.ts'
import { frameAt, frameGrid, intersects, type Frame, type Rect } from './grid.ts'
import { hitTest, type Point } from './hit-test.ts'
import { align, distribute, type Alignment, type Distribution, type Offset } from './arrange.ts'
import { coverCrop, cornersOfRect, cropOf, imageRect, panned, scaled } from './crop.ts'
import { exportClient } from './export-client.ts'
import { clickedBox, drawnBox, isShapeTool, newShape, newText, type ShapeTool } from './draw-tools.ts'
import {
  anchorOf, constrain, deleteAnchors, formatPath, hitPath, isSmooth, moveAnchors, moveControl, offsetPath, parsePath, pathBounds, sameRef, segmentsOf, splitSegment,
  type Anchor, type AnchorRef, type PenPath, type Side,
} from './path.ts'
import { rulerParts } from './rulers.ts'
import { paragraphAt, step, toggled, wordAt, type StyleToggle, type TextRange } from './text-edit.ts'
import { NUDGE, NUDGE_FAR, shortcutFor, type ShortcutAction } from './shortcuts.ts'
import { SNAP_DISTANCE, snapMove, snapResize, snapTargets, type Gap, type Guide, type Targets } from './snap.ts'
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
  /**
   * The font files of the named families, from our storage (#50): the editor asks for the families
   * the design uses that it doesn't ship, when it opens and whenever text names a new one. A family
   * the catalog doesn't have is left out, and its text draws in the fallback fonts.
   */
  fontFiles?: (families: string[]) => Promise<{ family: string; bytes: Uint8Array }[]>
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
/**
 * The caret and the other end of the selected range (#47), anchored in the text so edits arriving
 * from other tabs carry them along; the same place when nothing is selected.
 */
interface Editing extends Picked { caret: TextAnchor; anchor: TextAnchor; endGesture: () => void; created: boolean }
/** What a drag on the stage does: select and move, pan with the hand, draw a shape (#44), a path (#45) or a text box (#47). */
export type Tool = 'select' | 'hand' | 'pen' | 'text' | ShapeTool

/** How far, in screen pixels, a press can wander and still draw a shape as a click does. */
const CLICK_SLOP = 3
/** How near, in screen pixels, a press picks a path's point, handle or segment (#45). */
const POINT_REACH = 6
/** The pen's stroke until a style is picked: the near-black that lines draw with. */
const PEN_STROKE = { paint: { type: 'solid', color: '#1F2329FF' }, width: 2, cap: 'round', join: 'round' }

/** A path layer being drawn or edited: the box it had when that began, which its points are relative to, and how far the box has moved since. */
interface Reshaping { id: string; start: Box; applied: Point }

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
  // The fonts we ship, the fallbacks among them, load first; the design's own families once it is here.
  const fontBytes = await Promise.all(FONT_FACES.map(async (f) => ({ family: f.family, bytes: await bytes(`/vendor/fonts/${f.file}`) })))
  const resourceBytes = { fonts: fontBytes, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }
  // One cache for the screen and exports: fonts and images are decoded once for the editor's life.
  const cache = resourceCache(ck)
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
    const opened = readDesign(doc)
    const [images, fonts] = await Promise.all([
      loadImages(imageAssetIds(opened), options).catch((error: unknown) => {
        if (kept) return {}
        throw error
      }),
      loadFonts(fontFamilies(opened), options).catch((error: unknown) => {
        if (kept) return []
        throw error
      }),
    ])
    return live(ck, cache, { ...resourceBytes, fonts: [...resourceBytes.fonts, ...fonts], images }, doc, provider, local, options)
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


/** The families we ship are loaded already; the rest come from the catalog, when the editor was given a way. */
const SHIPPED_FAMILIES = new Set(FONT_FACES.map((f) => f.family))
async function loadFonts(families: string[], options: EditorOptions): Promise<{ family: string; bytes: Uint8Array }[]> {
  const wanted = families.filter((family) => !SHIPPED_FAMILIES.has(family))
  if (wanted.length === 0 || !options.fontFiles) return []
  return options.fontFiles(wanted)
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
  /** What the drag in progress snapped to, shown as guides and equal gaps (#42). */
  let snapped: { frame: Frame; guides: Guide[]; gaps: Gap[] } | null = null
  let rulers = true
  /** Told when the selection changes, so panels can follow it. */
  const selectionListeners = new Set<(ids: string[]) => void>()
  /** Told when the tool changes, by a key or after drawing a shape, so the tool dock follows. */
  const toolListeners = new Set<(tool: Tool) => void>()
  function setTool(next: Tool) {
    if (next === tool) return
    if (pen) finishPen()
    tool = next
    showCursor()
    for (const listener of toolListeners) listener(tool)
  }
  let lastSelection = ''
  /** The layer under the pointer, outlined while nothing is being dragged. */
  let hovered: Picked | null = null
  let editing: Editing | null = null
  /** The path layer whose points are being edited (#45), and which of its anchors are selected. */
  let pathEditing: { id: string; frame: string; selected: AnchorRef[] } | null = null
  /** The layer whose image fill is being cropped on the stage (#48). */
  let cropping: { id: string; frame: string } | null = null
  /**
   * The path the pen is drawing (#45), from its first click until it closes or is finished: its
   * anchors in its parent's coordinates, the one a drag is pulling handles from, and the layer
   * once there are two anchors to draw.
   */
  let pen: {
    frame: Frame; around: Box[]; parentId: string; anchors: Anchor[]; closing: boolean; dragging: number | null; from: Point
    moved: boolean; hover: Point | null; layer: Reshaping | null; end: () => void
  } | null = null
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

  // Auto layout measures text with the fonts the screen draws with (#46); a new font set measures anew.
  let measuring: { for: Resources; measure: MeasureText } | null = null
  const measureText = () => {
    if (measuring?.for !== resources) measuring = { for: resources, measure: textMeasure(ck, resources) }
    return measuring.measure
  }

  function cached(frame: Frame): FrameCache {
    const deps = depsOf(frame)
    const entry = frames.get(frame.key)
    if (entry && sameDeps(entry.deps, deps)) return entry
    entry?.picture?.delete()
    const fresh = { deps, scene: render(design, frame.pageId, frame.formatId, scenes, measureText()), picture: null }
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

  /** The editing layer's text, laid out as drawn, from the screen's cache, which owns it. */
  function editingText() {
    const found = pickedLayer(editing)
    if (found?.layer.type !== 'text') return null
    return { ...found, layer: found.layer, laid: paragraphs.layout(ck, found.layer.props, resources) }
  }
  /** The selected range of the text being edited; empty at the caret when nothing is selected. */
  function textRange(): TextRange | null {
    if (!editing) return null
    const caret = anchorOffset(doc, editing.caret)
    const anchor = anchorOffset(doc, editing.anchor)
    if (caret === null || caret === undefined) return null
    const other = anchor ?? caret
    return { start: Math.min(caret, other), end: Math.max(caret, other) }
  }
  /** Puts the caret at an offset; with `extend`, the other end of the range stays where it is. */
  function caretTo(offset: number, extend = false) {
    if (!editing) return
    editing.caret = textAnchor(doc, editing.id, offset)
    if (!extend) editing.anchor = editing.caret
  }
  /**
   * Keeps the box of text that grows the size of its words in every format (#47), and the groups
   * around it fitted, in the step the edit is in.
   */
  function fitText(id: string) {
    const now = session.design()
    const node = now.nodes[id]
    if (node?.type !== 'text') return
    const measure = measureText()
    const sizes: Record<string, { width: number; height: number }> = {}
    for (const formatId of Object.keys(now.formats)) {
      const props = { ...node.props, ...now.overrides[`format:${formatId}`]?.[id] } as typeof node.props
      if (props.boxMode === 'fixed') continue
      const size = measure(props, props.boxMode === 'autoWidth' ? null : props.width)
      sizes[formatId] = { width: props.boxMode === 'autoWidth' ? size.width : props.width, height: size.height }
    }
    if (Object.keys(sizes).length === 0) return
    runQuietly(() => session.run('text.fit', { id, sizes }))
    hug([id])
  }
  /** Selects a range, the caret at its end. */
  function selectText(range: TextRange) {
    if (!editing) return
    editing.anchor = textAnchor(doc, editing.id, range.start)
    editing.caret = textAnchor(doc, editing.id, range.end)
  }

  /**
   * A layer's box in one frame, read from the document: the base with the format's overrides.
   * Hidden layers have one too, so they move with a group and stay selected.
   */
  function boxIn(frame: Frame, id: string, from: Design = session.design()): Box | null {
    const node = from.nodes[id]
    if (!node) return null
    // Auto layout places and sizes a layer as the scene is built (#46): its box is the scene's.
    if (laidOut(id, from)) {
      const shown = find(cached(frame).scene.layers, id)
      if (shown) return { x: shown.props.x, y: shown.props.y, width: shown.props.width, height: shown.props.height, rotation: shown.props.rotation }
    }
    const p = { ...node.props, ...from.overrides[scope(frame)]?.[id] } as { x: number; y: number; width: number; height: number; rotation?: number }
    return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0 }
  }
  /** Whether auto layout sizes or places a layer: an auto layout frame, or a layer anywhere inside one. */
  function laidOut(id: string, from: Design) {
    for (let up: string | undefined = id; up && from.nodes[up]; up = from.nodes[up]?.parentId) {
      const node = from.nodes[up]
      if (node?.type === 'frame' && (node.props.layout || Object.values(from.overrides).some((o) => o[up as string]?.layout))) return true
    }
    return false
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
    if (pathEditing && (!selection?.ids.includes(pathEditing.id) || !isPath(design, pathEditing.id))) pathEditing = null
    if (cropping && (!selection?.ids.includes(cropping.id) || selection.frame !== cropping.frame)) cropping = null
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
    if (pathEditing && (ids.length !== 1 || ids[0] !== pathEditing.id || frame !== pathEditing.frame)) pathEditing = null
    if (cropping && (ids.length !== 1 || ids[0] !== cropping.id || frame !== cropping.frame)) cropping = null
    drawOverlay()
  }

  /** A point inside containers as it is on the page: back through each one's turn, innermost first. */
  function pageFrom(q: Point, around: Box[]): Point {
    let p = q
    for (const outer of [...around].reverse()) p = turn(p, centreOf(outer), outer.rotation)
    return p
  }
  const isPath = (from: Design, id: string) => {
    const node = from.nodes[id]
    return node?.type === 'graphic' && node.props.shape.kind === 'path'
  }
  /**
   * A path layer's path in one frame, in the coordinates of its parent before the layer turns it
   * (#45), with its box and what turns it: its containers, then the layer itself.
   */
  function pathIn(frame: Frame, id: string, from: Design = session.design()) {
    const node = from.nodes[id]
    const box = boxIn(frame, id, from)
    if (node?.type !== 'graphic' || !box) return null
    const shape = { ...node.props, ...from.overrides[scope(frame)]?.[id] }.shape
    if (shape.kind !== 'path') return null
    try {
      return { path: offsetPath(parsePath(shape.d), box.x, box.y), box, around: [...containersOf(frame, node.parentId, from), box] }
    } catch {
      return null
    }
  }
  /**
   * Writes a path drawn or edited in the coordinates its layer had when that began (#45): the data
   * from the outline's corner, and the box moved by what the corner moved since the last write.
   */
  function reshape(layer: Reshaping, path: PenPath) {
    const b = pathBounds(path)
    if (!b) return
    const corner = { x: round(b.x), y: round(b.y) }
    const moved = { x: round(corner.x - layer.start.x), y: round(corner.y - layer.start.y) }
    const input = { id: layer.id, d: formatPath(path, corner), dx: round(moved.x - layer.applied.x), dy: round(moved.y - layer.applied.y), width: round(b.width), height: round(b.height) }
    if (runQuietly(() => session.run('node.reshape', input))) layer.applied = moved
  }

  /**
   * The image fill a crop works on (#48): the topmost of a layer's fills in a frame, with where the
   * whole image sits for the crop it shows now (fill's when it has none of its own), the image and
   * its size, and the layer's box with its containers, the box last.
   */
  function cropTarget(frame: Frame, id: string, from: Design = session.design()) {
    const node = from.nodes[id]
    const box = boxIn(frame, id, from)
    if (!node || !box || !('fills' in node.props)) return null
    const { fills } = { ...node.props, ...from.overrides[scope(frame)]?.[id] } as { fills: Paint[] }
    const index = fills.findLastIndex((f) => f.type === 'image')
    const fill = fills[index]
    const image = fill?.type === 'image' ? resources.images.get(fill.assetId) : undefined
    if (fill?.type !== 'image' || !image) return null
    const size = { width: image.width(), height: image.height() }
    const crop = fill.fit === 'crop' && fill.crop ? fill.crop : coverCrop(size, box)
    return { fills, index, fill, image, size, box, rect: imageRect(crop, size, box), around: [...containersOf(frame, node.parentId, from), box] }
  }
  type CropTarget = NonNullable<ReturnType<typeof cropTarget>>
  /** Each image as a URL for the crop's faint whole image, made once from the decoded image. */
  const ghosts = new WeakMap<Image, string>()
  function ghostOf(image: Image) {
    let url = ghosts.get(image)
    if (url === undefined) {
      const png = image.encodeToBytes()
      url = png ? URL.createObjectURL(new Blob([png.slice()], { type: 'image/png' })) : ''
      ghosts.set(image, url)
    }
    return url
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

  /** The crop being made (#48): the whole image, faint outside the layer, a handle on each corner. */
  function cropParts(): HTMLElement[] {
    const frame = cropping && frameOf(cropping.frame)
    const target = frame && cropping && cropTarget(frame, cropping.id)
    if (!frame || !target) return []
    const { box, rect, around } = target
    const whole = outline('crop-image', frame, drawnFrom({ ...rect, rotation: 0 }, around))
    const ghost = document.createElement('div')
    ghost.className = 'crop-ghost'
    ghost.style.backgroundImage = `url("${ghostOf(target.image)}")`
    // Clear over the box, where the layer shows the image itself.
    const [l, t, r, b] = [box.x - rect.x, box.y - rect.y, box.x + box.width - rect.x, box.y + box.height - rect.y]
      .map((v, i) => `${(v / (i % 2 === 0 ? rect.width : rect.height)) * 100}%`)
    ghost.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${l} ${b}, ${r} ${b}, ${r} ${t}, ${l} ${t})`
    whole.append(ghost)
    for (const i of cornersOfRect(rect).keys()) {
      const handle = document.createElement('div')
      handle.className = 'handle'
      handle.dataset.cropCorner = String(i)
      Object.assign(handle.style, { left: `${i === 1 || i === 2 ? 100 : 0}%`, top: `${i >= 2 ? 100 : 0}%` })
      whole.append(handle)
    }
    const shown = outline('selection', frame, drawnFrom(box, around.slice(0, -1)))
    shown.dataset.cropping = cropping?.id
    return [whole, shown]
  }

  let drawnFrames: Frame[] = []
  function drawOverlay() {
    const parts: Element[] = []
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
    parts.push(...(pathEditing || cropping ? [] : selectionParts()), ...pathParts(), ...cropParts())
    if (gesture?.kind === 'textBox') {
      // The box the text tool is drawing (#47), drawn as a marquee is.
      const box = document.createElement('div')
      box.className = 'marquee'
      box.dataset.textBox = ''
      placeBox(box, gesture.frame, { x: Math.min(gesture.from.x, gesture.to.x), y: Math.min(gesture.from.y, gesture.to.y), width: Math.abs(gesture.to.x - gesture.from.x), height: Math.abs(gesture.to.y - gesture.from.y) })
      parts.push(box)
    }
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
    if (snapped) parts.push(...snapParts(snapped))
    if (rulers) {
      const origin = frameOf(selection?.frame) ?? frameOf(hovered?.frame) ?? drawnFrames[0]
      const outer = selectionBox()
      if (origin) parts.push(...rulerParts(camera, viewport, origin, outer && outer.frame.key === origin.key ? boundsOf([outer.drawn]) : null))
    }
    const text = editingText()
    const offset = editing && anchorOffset(doc, editing.caret)
    const range = textRange()
    if (text && range && range.end > range.start) {
      // The selected range, one box per run of one direction on one line (#47).
      for (const box of selectionBoxes(ck, text.laid, range.start, range.end)) {
        const el = document.createElement('div')
        el.className = 'text-selection'
        placeBox(el, text.frame, { x: text.layer.props.x + box.x, y: text.layer.props.y + text.laid.dy + box.y, width: box.width, height: box.height })
        parts.push(el)
      }
    } else if (text && offset !== null && offset !== undefined) {
      const at = caretPosition(ck, text.laid, offset)
      const caret = document.createElement('div')
      caret.className = 'caret'
      placeBox(caret, text.frame, { x: text.layer.props.x + at.x, y: text.layer.props.y + text.laid.dy + at.y, width: 0, height: at.height })
      caret.style.width = ''
      parts.push(caret)
    }
    overlay.replaceChildren(...parts)
    const now = selection ? `${selection.frame}|${selection.ids.join(',')}` : ''
    if (now !== lastSelection) {
      lastSelection = now
      for (const listener of selectionListeners) listener(selection?.ids ?? [])
    }
  }

  const SVG = 'http://www.w3.org/2000/svg'
  /**
   * The path the pen is drawing or whose points are being edited (#45): its outline, its anchors,
   * the handles of the anchors in play, and, for the pen, the next segment to where the pointer is.
   */
  function pathParts(): Element[] {
    let frame: Frame | undefined
    let path: PenPath
    let around: Box[]
    let shown: AnchorRef[]
    let preview: [Anchor, Point] | null = null
    if (pen) {
      frame = pen.frame
      path = [{ anchors: pen.anchors, closed: pen.closing }]
      around = pen.around
      const last = pen.anchors.length - 1
      shown = [{ contour: 0, index: pen.dragging ?? last }]
      const from = pen.anchors[last]
      if (from && pen.hover && pen.dragging === null) preview = [from, pen.hover]
    } else if (pathEditing) {
      frame = frameOf(pathEditing.frame)
      const found = frame && pathIn(frame, pathEditing.id, design)
      if (!found) return []
      ;({ path, around } = found)
      shown = pathEditing.selected
    } else {
      return []
    }
    if (!frame) return []
    const f = frame
    const at = (q: Point) => {
      const p = pageFrom(q, around)
      return toScreen(camera, { x: f.x + p.x, y: f.y + p.y })
    }
    const xy = (q: Point) => {
      const p = at(q)
      return `${round(p.x)} ${round(p.y)}`
    }
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('class', 'path-edit')
    const line = (className: string, d: string) => {
      const el = document.createElementNS(SVG, 'path')
      el.setAttribute('class', className)
      el.setAttribute('d', d)
      svg.append(el)
    }
    const outline: string[] = []
    for (const contour of path) {
      const [first] = contour.anchors
      if (!first) continue
      outline.push(`M${xy(first)}`)
      for (const [from, to] of segmentsOf(contour)) {
        const a = contour.anchors[from] as Anchor
        const b = contour.anchors[to] as Anchor
        outline.push(`C${xy(a.out ?? a)} ${xy(b.in ?? b)} ${xy(b)}`)
      }
    }
    line('path-outline', outline.join(' '))
    if (preview) {
      const [from, to] = preview
      line('pen-preview', `M${xy(from)} C${xy(from.out ?? from)} ${xy(to)} ${xy(to)}`)
    }
    const dots: HTMLElement[] = []
    const dot = (className: string, q: Point, data: Record<string, string>) => {
      const el = document.createElement('div')
      el.className = className
      const p = at(q)
      Object.assign(el.style, { left: px(p.x), top: px(p.y) })
      Object.assign(el.dataset, data)
      dots.push(el)
    }
    for (const ref of shown) {
      const anchor = anchorOf(path, ref)
      for (const side of ['in', 'out'] as const) {
        const h = anchor?.[side]
        if (!anchor || !h) continue
        line('path-handle-line', `M${xy(anchor)} L${xy(h)}`)
        dot('path-control', h, { control: `${ref.contour}:${ref.index}:${side}` })
      }
    }
    path.forEach((contour, c) => contour.anchors.forEach((a, i) => {
      const data: Record<string, string> = { anchor: `${c}:${i}` }
      if (shown.some((r) => sameRef(r, { contour: c, index: i })) && pathEditing) data.selected = ''
      // The pen's first anchor shows when a click on it would close the path.
      if (pen && i === 0 && pen.anchors.length >= 2 && pen.hover && Math.hypot(pen.hover.x - a.x, pen.hover.y - a.y) * camera.zoom <= POINT_REACH) data.closing = ''
      dot('path-anchor', a, data)
    }))
    return [svg, ...dots]
  }

  /** Snap guides as lines across the page, and equal gaps as marked spans with their size. */
  function snapParts({ frame, guides, gaps }: NonNullable<typeof snapped>) {
    const parts: HTMLElement[] = []
    for (const g of guides) {
      const line = document.createElement('div')
      line.className = 'guide'
      line.dataset.axis = g.axis
      placeBox(line, frame, g.axis === 'x' ? { x: g.at, y: g.from, width: 0, height: g.to - g.from } : { x: g.from, y: g.at, width: g.to - g.from, height: 0 })
      parts.push(line)
    }
    for (const g of gaps) {
      const span = document.createElement('div')
      span.className = 'gap'
      span.dataset.axis = g.axis
      placeBox(span, frame, g.axis === 'x' ? { x: g.from, y: g.at, width: g.to - g.from, height: 0 } : { x: g.at, y: g.from, width: 0, height: g.to - g.from })
      const size = document.createElement('span')
      size.textContent = String(round(g.to - g.from, 0))
      span.append(size)
      parts.push(span)
    }
    return parts
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

  // Exports are drawn in a worker of their own (#55), started at the first one.
  const exporter = exportClient()

  // Images that arrive after the design (another tab added them) load in the background; until
  // then the screen draws them clear. Exports never do: they throw until every image is loaded.
  const maybeClear = ck.MakeImage({ width: 1, height: 1, alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB }, new Uint8Array(4), 4)
  if (!maybeClear) throw new Error('could not make the image placeholder')
  const clear: Image = maybeClear
  const loading = new Set<string>()
  /** The last resources with placeholders, kept while the same images are missing so pictures stay. */
  let placeholders: { for: Resources; missing: string; resources: Resources } | null = null
  // Families text names after the design opened (a pick in the font menu, another tab) load in the
  // background (#50); until then that text draws in the fallback fonts. Exports wait for them.
  const fontsAsked = new Set([...SHIPPED_FAMILIES, ...resourceBytes.fonts.map((f) => f.family)])
  let fontsLoading: Promise<void> = Promise.resolve()
  function loadNewFonts(current: Design) {
    if (!options.fontFiles) return
    const fresh = fontFamilies(current).filter((family) => !fontsAsked.has(family))
    if (fresh.length === 0) return
    for (const family of fresh) fontsAsked.add(family)
    const loading = loadFonts(fresh, options).then((fonts) => {
      if (listening.signal.aborted || fonts.length === 0) return
      resourceBytes = { ...resourceBytes, fonts: [...resourceBytes.fonts, ...fonts] }
      resources = cache.resources(resourceBytes)
      // Auto layout measures text in its font, so every frame's scene is made again, not only its picture.
      for (const entry of frames.values()) entry.picture?.delete()
      frames.clear()
      redraw()
    }, (error: unknown) => {
      // Offline, a family waits for the connection; the next redraw asks for it again.
      if (connection !== WebSocketStatus.Connected) {
        for (const family of fresh) fontsAsked.delete(family)
        return
      }
      status(`Error: a font did not load (${error instanceof Error ? error.message : String(error)})`)
    })
    fontsLoading = Promise.all([fontsLoading, loading]).then(() => undefined)
  }

  function screenResources(current: Design): Resources {
    loadNewFonts(current)
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
    if (!editing) return
    // A text box made with the text tool and left empty goes again, in the same undo step.
    const { id } = editing
    const node = session.design().nodes[id]
    if (node?.type === 'text' && node.props.text === '' && editing.created) runQuietly(() => session.run('node.delete', { ids: [id] }))
    editing.endGesture()
    editing = null
  }
  /** Starts typing into a text layer in a frame, in one undo step until typing stops. */
  function startEditing(id: string, frame: string, offset: number, endGesture = session.beginGesture(), created = false) {
    const at = textAnchor(doc, id, offset)
    editing = { id, frame, caret: at, anchor: at, endGesture, created }
  }

  function caretFromPoint(p: Point) {
    const text = editingText()
    if (!text) return 0
    return caretAt(ck, text.laid, p.x - text.layer.props.x, p.y - text.layer.props.y - text.laid.dy)
  }

  /** What a drag on the stage is doing, from pointer down to up. */
  type Gesture =
    | { kind: 'move'; frame: Frame; around: Box[]; from: Point; roots: string[]; boxes: Map<string, Box>; targets: Targets | null; end: () => void }
    | { kind: 'resize'; frame: Frame; around: Box[]; handle: Handle; outer: Box; grab: Point; roots: string[]; boxes: Map<string, Box>; targets: Targets | null; end: () => void }
    | { kind: 'rotate'; frame: Frame; around: Box[]; outer: Box; from: number; roots: string[]; boxes: Map<string, Box>; end: () => void }
    | { kind: 'marquee'; from: Point; to: Point; base: string[]; baseFrame: string | null }
    | { kind: 'textSelect'; frame: Frame; around: Box[] }
    | { kind: 'textBox'; frame: Frame; around: Box[]; parentId: string; from: Point; to: Point }
    | { kind: 'crop'; frame: Frame; around: Box[]; id: string; corner: number | null; grab: Point; start: CropTarget; roots: string[]; end: () => void }
    | { kind: 'draw'; tool: ShapeTool; frame: Frame; around: Box[]; from: Point; id: string; moved: boolean; roots: string[]; end: () => void }
    | {
      kind: 'path'; frame: Frame; around: Box[]; layer: Reshaping; path: PenPath; grab: Point; moved: boolean; roots: string[]; end: () => void
      drag: { anchors: AnchorRef[] } | { ref: AnchorRef; side: Side; from: Point; mirror: boolean }
    }
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

  function moveTo(g: Extract<Gesture, { kind: 'move' }>, p: Point, axisLock: boolean, snap: boolean) {
    let dx = p.x - g.from.x
    let dy = p.y - g.from.y
    // Shift keeps a move to one axis, whichever it has gone further along.
    if (axisLock) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    // A move lands on whole pixels, unless it snapped to a line that isn't on one.
    let toX = Math.round
    let toY = Math.round
    snapped = null
    const moving = g.roots.map((id) => g.boxes.get(id)).filter((b): b is Box => b !== undefined)
    if (snap && g.targets && moving.length > 0) {
      const from = boundsOf(moving)
      const s = snapMove({ ...from, x: Math.round(from.x + dx), y: Math.round(from.y + dy) }, g.targets, SNAP_DISTANCE / camera.zoom, { x: axisLock && dx === 0, y: axisLock && dy === 0 })
      if (s.dx !== 0) {
        dx = Math.round(from.x + dx) + s.dx - from.x
        toX = (n) => round(n)
      }
      if (s.dy !== 0) {
        dy = Math.round(from.y + dy) + s.dy - from.y
        toY = (n) => round(n)
      }
      snapped = { frame: g.frame, guides: s.guides, gaps: s.gaps }
    }
    const next = new Map([...g.boxes].map(([id, b]) => [id, { ...b, x: toX(b.x + dx), y: toY(b.y + dy) }]))
    writeBoxes(g.frame, g.boxes, next)
  }

  /**
   * What a drag in a frame can snap to: the layers on the page as drawn and, inside a group or
   * frame, the layers beside the selection and the container itself; and the format. Nothing
   * inside a turned container snaps, since its lines don't run along the page.
   */
  function targetsFor(frame: Frame, ids: string[], around: Box[]): Targets | null {
    if (around.some((b) => b.rotation !== 0)) return null
    const now = session.design()
    const format = now.formats[frame.formatId]
    if (!format) return null
    const holds = (id: string) => ids.some((selected) => {
      for (let up: string | undefined = selected; up && now.nodes[up]; up = now.nodes[up]?.parentId) if (up === id) return true
      return false
    })
    const others = cached(frame).scene.layers.filter((layer) => !holds(layer.id)).map((layer) => boundsOf([layer.props]))
    const parent = now.nodes[ids[0] ?? '']?.parentId
    if (parent && now.nodes[parent]) {
      const box = boxIn(frame, parent, now)
      if (box) others.push(box)
      for (const [id] of childrenOf(now, parent)) {
        const sibling = !ids.includes(id) && visibleIn(frame, id) && boxIn(frame, id, now)
        if (sibling) others.push(boundsOf([sibling]))
      }
    }
    return snapTargets(others, { x: 0, y: 0, width: format.width, height: format.height })
  }

  function resizeTo(g: Extract<Gesture, { kind: 'resize' }>, p: Point, keepRatio: boolean, fromCentre: boolean, snap: boolean) {
    // The handle follows the pointer from where it was grabbed, so a press off its centre doesn't jump.
    const at = handleAt(g.handle)
    const handle = turn({ x: g.outer.x + at.x * g.outer.width, y: g.outer.y + at.y * g.outer.height }, centreOf(g.outer), g.outer.rotation)
    const to = { x: handle.x + p.x - g.grab.x, y: handle.y + p.y - g.grab.y }
    let outer = resizeBox(g.outer, g.handle, to, { keepRatio, fromCentre })
    snapped = null
    // The dragged edges snap; a turned box has none that run along the page.
    if (snap && g.targets && outer.rotation === 0) {
      const s = snapResize(outer, g.handle, g.targets, SNAP_DISTANCE / camera.zoom)
      if (s.dx !== 0 || s.dy !== 0) outer = resizeBox(g.outer, g.handle, { x: to.x + s.dx, y: to.y + s.dy }, { keepRatio, fromCentre })
      snapped = { frame: g.frame, guides: s.guides, gaps: [] }
    }
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
    if (!outer || editing || pathEditing) return null
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
    canvas.style.cursor = pan ? 'grabbing' : panning() ? 'grab' : isShapeTool(tool) || tool === 'pen' ? 'crosshair' : tool === 'text' ? 'text' : hoverCursor
  }
  function cursorFor(screen: Point) {
    if (gesture?.kind === 'resize' || gesture?.kind === 'rotate') return
    if (cropping) {
      // Cropping, the image moves under the pointer; the box's handles are gone (#48).
      hoverCursor = 'move'
      showCursor()
      return
    }
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
    if (isShapeTool(tool)) {
      if (at) startDrawing(e, tool, at)
      return
    }
    if (tool === 'pen') {
      if (at) penDown(e, at)
      return
    }
    if (tool === 'text') {
      if (at) startTextBox(e, at)
      return
    }
    if (pathEditing && startPathEdit(e, at)) return
    if (cropping && startCrop(e, screen)) return
    const deepest = at && hitTest(cached(at.frame).scene.layers, at.p, pickable)
    if (at && editing && deepest?.id === editing.id && editing.frame === at.frame.key) {
      // In the text being edited (#47): a press puts the caret there, Shift extends the range to
      // it, a drag selects, and a third click selects the paragraph.
      const offset = caretFromPoint(at.p)
      const node = session.design().nodes[editing.id]
      if (e.detail >= 3 && node?.type === 'text') {
        selectText(paragraphAt(node.props.text, offset))
      } else {
        caretTo(offset, e.shiftKey)
        if (e.detail <= 1) {
          canvas.setPointerCapture(e.pointerId)
          gesture = { kind: 'textSelect', frame: at.frame, around: [] }
        }
      }
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
      if (grabbed.kind === 'resize') gesture = { kind: 'resize', frame: outer.frame, around, handle: grabbed.handle, outer: outer.box, grab, roots: ids, boxes, targets: targetsFor(outer.frame, ids, around), end }
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
    gesture = { kind: 'move', frame, around, from: localTo(at.p, around), roots: ids, boxes: startBoxes(frame, ids), targets: targetsFor(frame, ids, around), end: session.beginGesture() }
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
    if (pen) {
      penMove(e)
      return
    }
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
    if (gesture.kind === 'textSelect') {
      caretTo(caretFromPoint(p), true)
      drawOverlay()
      return
    }
    if (gesture.kind === 'textBox') {
      gesture.to = p
      drawOverlay()
      return
    }
    if (gesture.kind === 'draw') {
      drawTo(gesture, p, e.shiftKey, e.altKey)
      return
    }
    if (gesture.kind === 'path') {
      pathTo(gesture, p, e.shiftKey, e.altKey)
      return
    }
    if (gesture.kind === 'crop') {
      cropTo(gesture, p)
      return
    }
    // Holding Ctrl (⌘ on a Mac) turns snapping off for as long as it is held.
    const snap = !(e.ctrlKey || e.metaKey)
    if (gesture.kind === 'move') moveTo(gesture, p, e.shiftKey, snap)
    else if (gesture.kind === 'resize') resizeTo(gesture, p, e.shiftKey, e.altKey, snap)
    else rotateTo(gesture, p, e.shiftKey)
  }, on)

  /**
   * Starts drawing a shape where the pointer went down (#44): inside the group, frame or boolean
   * double-clicked into if the press is in it, otherwise on the page. The new layer and every
   * change the drag makes to it are one undo step.
   */
  function startDrawing(e: PointerEvent, shape: ShapeTool, at: { frame: Frame; p: Point }) {
    stopEditing()
    const now = session.design()
    const inside = entered ? now.nodes[entered] : undefined
    const parentId = entered && inside && canHold(inside.type, 'graphic') ? entered : at.frame.pageId
    const around = containersOf(at.frame, parentId, now)
    const from = localTo(at.p, around)
    const end = session.beginGesture()
    let id = ''
    if (!runQuietly(() => { id = session.run('node.create', { parentId, layer: newShape(shape) }) })) {
      end()
      return
    }
    canvas.setPointerCapture(e.pointerId)
    gesture = { kind: 'draw', tool: shape, frame: at.frame, around, from, id, moved: false, roots: [id], end }
    runQuietly(() => session.run('node.update', { ids: [id], patch: drawnBox(shape, from, from, false, false) }))
  }

  /**
   * A press while cropping (#48): on a corner of the image it scales it, on the image it moves it,
   * and anywhere else it ends the crop and acts as a press does. Each drag is one undo step.
   */
  function startCrop(e: PointerEvent, screen: Point) {
    const frame = cropping && frameOf(cropping.frame)
    const target = frame && cropping && cropTarget(frame, cropping.id)
    if (!frame || !target || !cropping) {
      cropping = null
      return false
    }
    const { rect, around } = target
    const onScreen = (q: Point) => {
      const page = pageFrom(q, around)
      return toScreen(camera, { x: frame.x + page.x, y: frame.y + page.y })
    }
    const corner = cornersOfRect(rect).findIndex((q) => {
      const c = onScreen(q)
      return Math.hypot(c.x - screen.x, c.y - screen.y) <= HANDLE_REACH
    })
    const world = toWorld(camera, screen)
    const grab = localTo({ x: world.x - frame.x, y: world.y - frame.y }, around)
    const onImage = grab.x >= rect.x && grab.x <= rect.x + rect.width && grab.y >= rect.y && grab.y <= rect.y + rect.height
    if (corner === -1 && !onImage) {
      cropping = null
      drawOverlay()
      return false
    }
    canvas.setPointerCapture(e.pointerId)
    gesture = { kind: 'crop', frame, around, id: cropping.id, corner: corner === -1 ? null : corner, grab, start: target, roots: [], end: session.beginGesture() }
    return true
  }
  /** Writes the crop a drag gives, in this format, as the fill's own crop. */
  function cropTo(g: Extract<Gesture, { kind: 'crop' }>, p: Point) {
    const { start } = g
    const rect = g.corner === null ? panned(start.rect, start.box, p.x - g.grab.x, p.y - g.grab.y) : scaled(start.rect, start.box, g.corner, p)
    const c = cropOf(rect, start.size, start.box)
    const crop = { x: Math.max(0, round(c.x)), y: Math.max(0, round(c.y)), width: round(c.width), height: round(c.height) }
    const fills = start.fills.map((f, i) => (i === start.index ? { ...start.fill, fit: 'crop' as const, crop } : f))
    runQuietly(() => session.run('node.update', { ids: [g.id], scope: scope(g.frame), patch: { fills } }))
    drawOverlay()
  }

  /** A press with the text tool (#47): a click makes text that grows as it is typed, a drag a box of that size. */
  function startTextBox(e: PointerEvent, at: { frame: Frame; p: Point }) {
    stopEditing()
    const now = session.design()
    const inside = entered ? now.nodes[entered] : undefined
    const parentId = entered && inside && canHold(inside.type, 'text') ? entered : at.frame.pageId
    const around = containersOf(at.frame, parentId, now)
    const from = localTo(at.p, around)
    canvas.setPointerCapture(e.pointerId)
    gesture = { kind: 'textBox', frame: at.frame, around, parentId, from, to: from }
  }
  /** Makes the text layer the text tool drew and starts typing into it, one undo step with the typing. */
  function finishTextBox(g: Extract<Gesture, { kind: 'textBox' }>) {
    const dragged = Math.max(Math.abs(g.to.x - g.from.x), Math.abs(g.to.y - g.from.y)) * camera.zoom >= CLICK_SLOP
    const box = dragged
      ? { x: Math.min(g.from.x, g.to.x), y: Math.min(g.from.y, g.to.y), width: Math.abs(g.to.x - g.from.x), height: Math.abs(g.to.y - g.from.y) }
      : null
    const end = session.beginGesture()
    let id = ''
    if (!runQuietly(() => { id = session.run('node.create', { parentId: g.parentId, layer: newText(round(g.from.x), round(g.from.y), box && { width: round(box.width), height: round(box.height), x: round(box.x), y: round(box.y) }) }) })) {
      end()
      return
    }
    setTool('select')
    select([id], g.frame.key)
    startEditing(id, g.frame.key, 0, end, true)
  }

  /** Grows the shape being drawn to the pointer; a few screen pixels count as a click still. */
  function drawTo(g: Extract<Gesture, { kind: 'draw' }>, p: Point, shift: boolean, alt: boolean) {
    if (!g.moved && Math.hypot(p.x - g.from.x, p.y - g.from.y) * camera.zoom < CLICK_SLOP) return
    g.moved = true
    runQuietly(() => session.run('node.update', { ids: [g.id], patch: drawnBox(g.tool, g.from, p, shift, alt) }))
  }

  /**
   * A press while a path's points are being edited (#45): on a handle of a selected anchor, drag
   * it; on an anchor, select it (Shift adds or takes it away) and drag the selected ones; on a
   * segment, add an anchor there and drag it, all one undo step. Anywhere else leaves the path,
   * and the press does what it would have done. Returns whether the press was the path's.
   */
  function startPathEdit(e: PointerEvent, at: { frame: Frame; p: Point } | null) {
    const editingPath = pathEditing
    const frame = editingPath && frameOf(editingPath.frame)
    const found = frame && editingPath && pathIn(frame, editingPath.id)
    const q = found && at?.frame.key === frame.key ? localTo(at.p, found.around) : null
    const hit = found && q && hitPath(found.path, q, POINT_REACH / camera.zoom, editingPath.selected)
    if (!editingPath || !frame || !found || !q || !hit) {
      pathEditing = null
      drawOverlay()
      return false
    }
    let path = found.path
    const layer: Reshaping = { id: editingPath.id, start: found.box, applied: { x: 0, y: 0 } }
    const end = session.beginGesture()
    let drag: Extract<Gesture, { kind: 'path' }>['drag']
    if (hit.kind === 'control') {
      drag = { ref: hit.ref, side: hit.side, from: anchorOf(path, hit.ref)?.[hit.side] ?? q, mirror: isSmooth(anchorOf(path, hit.ref) as Anchor) }
    } else if (hit.kind === 'anchor') {
      const picked = editingPath.selected.some((r) => sameRef(r, hit.ref))
      if (e.shiftKey) editingPath.selected = picked ? editingPath.selected.filter((r) => !sameRef(r, hit.ref)) : [...editingPath.selected, hit.ref]
      else if (!picked) editingPath.selected = [hit.ref]
      drag = { anchors: editingPath.selected }
    } else {
      const split = splitSegment(path, hit.contour, hit.from, hit.t)
      path = split.path
      reshape(layer, path)
      editingPath.selected = [split.ref]
      drag = { anchors: [split.ref] }
    }
    canvas.setPointerCapture(e.pointerId)
    gesture = { kind: 'path', frame, around: found.around, layer, path, grab: q, moved: false, roots: [editingPath.id], end, drag }
    drawOverlay()
    return true
  }

  /** Drags anchors (Shift along one axis) or a handle (Shift in 45° steps; Alt lets a smooth anchor's other handle be). */
  function pathTo(g: Extract<Gesture, { kind: 'path' }>, p: Point, shift: boolean, alt: boolean) {
    if (!g.moved && Math.hypot(p.x - g.grab.x, p.y - g.grab.y) * camera.zoom < CLICK_SLOP) return
    g.moved = true
    let dx = p.x - g.grab.x
    let dy = p.y - g.grab.y
    if ('anchors' in g.drag) {
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      reshape(g.layer, moveAnchors(g.path, g.drag.anchors, round(dx), round(dy)))
      return
    }
    const anchor = anchorOf(g.path, g.drag.ref)
    if (!anchor) return
    const to = { x: g.drag.from.x + dx, y: g.drag.from.y + dy }
    const placed = shift ? constrain(anchor, to) : to
    reshape(g.layer, moveControl(g.path, g.drag.ref, g.drag.side, { x: round(placed.x), y: round(placed.y) }, g.drag.mirror && !alt))
  }

  /** Takes the selected anchors out of the path being edited, or the layer once none would be left. One undo step. */
  function deletePoints() {
    const editingPath = pathEditing
    const frame = editingPath && frameOf(editingPath.frame)
    const found = frame && editingPath && pathIn(frame, editingPath.id)
    if (!editingPath || !found || editingPath.selected.length === 0) return false
    const next = deleteAnchors(found.path, editingPath.selected)
    const parent = session.design().nodes[editingPath.id]?.parentId ?? ''
    session.gesture(() => {
      if (next.length === 0) runQuietly(() => session.run('node.delete', { ids: [editingPath.id] }))
      else reshape({ id: editingPath.id, start: found.box, applied: { x: 0, y: 0 } }, next)
      hug(session.design().nodes[parent] ? [parent] : next.length > 0 ? [editingPath.id] : [])
    })
    editingPath.selected = []
    return true
  }

  /**
   * A press with the pen (#45): a click adds a corner, a drag pulls out smooth handles, Shift turns
   * the new segment to 45°, and a press on the first anchor closes the path. The first press
   * starts one undo step that lasts until the path is closed or finished; the layer appears with
   * the second anchor, inside the group, frame or boolean double-clicked into if it can hold it.
   */
  function penDown(e: PointerEvent, at: { frame: Frame; p: Point }) {
    stopEditing()
    if (pen && pen.frame.key !== at.frame.key) finishPen()
    if (!pen) {
      const now = session.design()
      const inside = entered ? now.nodes[entered] : undefined
      const parentId = entered && inside && canHold(inside.type, 'graphic') ? entered : at.frame.pageId
      const around = containersOf(at.frame, parentId, now)
      pen = { frame: at.frame, around, parentId, anchors: [], closing: false, dragging: null, from: at.p, moved: false, hover: null, layer: null, end: session.beginGesture() }
      selection = null
    }
    canvas.setPointerCapture(e.pointerId)
    const p = localTo(at.p, pen.around)
    const first = pen.anchors[0]
    const last = pen.anchors.at(-1)
    pen.from = p
    pen.moved = false
    if (first && pen.anchors.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) * camera.zoom <= POINT_REACH) {
      pen.closing = true
      pen.dragging = 0
    } else {
      const placed = e.shiftKey && last ? constrain(last, p) : p
      pen.anchors.push({ x: round(placed.x), y: round(placed.y) })
      pen.dragging = pen.anchors.length - 1
    }
    writePen()
    drawOverlay()
  }

  /** Pulls the handles out of the anchor just placed (Shift in 45° steps, Alt only the one ahead), or shows the next segment to the pointer. */
  function penMove(e: PointerEvent) {
    if (!pen) return
    const world = toWorld(camera, screenOf(e))
    const p = localTo({ x: world.x - pen.frame.x, y: world.y - pen.frame.y }, pen.around)
    const anchor = pen.dragging === null ? undefined : pen.anchors[pen.dragging]
    if (!anchor) {
      pen.hover = e.shiftKey && pen.anchors.at(-1) ? constrain(pen.anchors.at(-1) as Anchor, p) : p
      drawOverlay()
      return
    }
    if (!pen.moved && Math.hypot(p.x - pen.from.x, p.y - pen.from.y) * camera.zoom < CLICK_SLOP) return
    pen.moved = true
    const out = e.shiftKey ? constrain(anchor, p) : p
    anchor.out = { x: round(out.x), y: round(out.y) }
    if (!e.altKey) anchor.in = { x: round(2 * anchor.x - out.x), y: round(2 * anchor.y - out.y) }
    writePen()
    drawOverlay()
  }

  /** The press is over: a closing one finishes the path. */
  function penUp() {
    if (!pen) return
    pen.dragging = null
    if (pen.closing) finishPen()
    else drawOverlay()
  }

  /** Writes the pen's path to its layer, making the layer at the second anchor. */
  function writePen() {
    if (!pen || pen.anchors.length < 2) return
    const path: PenPath = [{ anchors: pen.anchors, closed: pen.closing }]
    if (pen.layer) {
      reshape(pen.layer, path)
      return
    }
    const b = pathBounds(path)
    if (!b) return
    const box = { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height), rotation: 0 }
    const { parentId } = pen
    let id = ''
    const shape = { kind: 'path', d: formatPath(path, box) }
    const layer = { type: 'graphic' as const, name: 'Path', props: { x: box.x, y: box.y, width: box.width, height: box.height, shape, strokes: [PEN_STROKE] } }
    if (runQuietly(() => { id = session.run('node.create', { parentId, layer }) })) pen.layer = { id, start: box, applied: { x: 0, y: 0 } }
  }

  /** Ends the pen's path, closed or open: the undo step ends, the new layer is selected, and the select tool comes back. */
  function finishPen() {
    const done = pen
    if (!done) return
    pen = null
    if (done.layer) hug([done.layer.id])
    done.end()
    if (done.layer && session.design().nodes[done.layer.id]) select([done.layer.id], done.frame.key)
    setTool('select')
    drawOverlay()
  }

  /** A click draws the shape at its usual size; either way the new shape is selected and the select tool comes back. */
  function finishDrawing(g: Extract<Gesture, { kind: 'draw' }>) {
    if (!g.moved) runQuietly(() => session.run('node.update', { ids: [g.id], patch: clickedBox(g.tool, g.from) }))
    hug([g.id])
    g.end()
    select([g.id], g.frame.key)
    setTool('select')
  }

  const endDrag = () => {
    snapped = null
    if (pen && !pan) {
      penUp()
      return
    }
    if (gesture?.kind === 'draw') {
      finishDrawing(gesture)
      gesture = null
      showCursor()
      drawOverlay()
      return
    }
    if (gesture?.kind === 'textBox') {
      finishTextBox(gesture)
      gesture = null
      showCursor()
      drawOverlay()
      return
    }
    if (gesture?.kind === 'textSelect') {
      gesture = null
      return
    }
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
    if (editing && hit.id === editing.id && editing.frame === at.frame.key) {
      // A double click in the text being edited selects the word there (#47).
      const node = session.design().nodes[editing.id]
      if (node?.type === 'text') selectText(wordAt(node.props.text, caretFromPoint(at.p)))
      drawOverlay()
      return
    }
    const picked = target(hit.id, at.frame.key)
    const container = design.nodes[picked]
    if (picked !== hit.id && container && isContainer(container.type)) {
      // Into the group, frame or boolean: what is directly inside it under the pointer gets picked.
      stopEditing()
      entered = picked
      selection = null
      select([target(hit.id, at.frame.key)], at.frame.key)
      return
    }
    if (cropTarget(at.frame, hit.id) && !design.nodes[hit.id]?.lock?.style) {
      // Into cropping its image fill (#48).
      stopEditing()
      select([hit.id], at.frame.key)
      cropping = { id: hit.id, frame: at.frame.key }
      drawOverlay()
      return
    }
    if (isPath(design, hit.id) && !design.nodes[hit.id]?.lock?.style) {
      // Into a path's points (#45).
      stopEditing()
      select([hit.id], at.frame.key)
      pathEditing = { id: hit.id, frame: at.frame.key, selected: [] }
      drawOverlay()
      return
    }
    if (hit.type !== 'text' || design.nodes[hit.id]?.lock?.content) return
    stopEditing()
    selection = { ids: [hit.id], frame: at.frame.key }
    startEditing(hit.id, at.frame.key, 0)
    caretTo(caretFromPoint(at.p))
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

  /** Keys typed into the page's own fields belong to them. */
  const inField = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

  /** Groups fit what they hold again after a change inside them, in the same undo step (#41). */
  function hug(ids: string[]) {
    const now = session.design()
    const live = ids.filter((id) => now.nodes[id])
    if (live.length > 0) runQuietly(() => session.run('node.hug', { ids: live }))
  }

  /** Combines the selected shapes into a live boolean (#44) and selects it. One undo step. */
  function combine(op: 'union' | 'subtract' | 'intersect' | 'exclude') {
    const frame = selection && frameOf(selection.frame)
    if (!frame) return
    let id = ''
    if (runQuietly(() => { id = session.run('node.boolean', { ids: roots(), op }) })) select([id], frame.key)
  }

  /**
   * Moves each selected layer, with what is inside it, by an offset worked out from the boxes
   * around them as drawn: align and distribute (#42). One undo step.
   */
  function arrange(offsets: (boxes: Rect[], within: Rect) => Offset[]) {
    const frame = selection && frameOf(selection.frame)
    const format = frame && design.formats[frame.formatId]
    if (!frame || !format) return false
    const now = session.design()
    const ids = roots(now)
    const boxes = startBoxes(frame, ids)
    // One layer lines up with what holds it: its group or frame, or the format.
    const parent = now.nodes[ids[0] ?? '']?.parentId
    const holder = parent && now.nodes[parent] ? boxIn(frame, parent, now) : null
    const within = holder ?? { x: 0, y: 0, width: format.width, height: format.height }
    const moves = offsets(ids.map((id) => boundsOf([boxes.get(id) as Box])), within)
    const next = new Map<string, Box>()
    ids.forEach((id, i) => {
      const { dx, dy } = moves[i] ?? { dx: 0, dy: 0 }
      for (const inner of [id, ...under(id, now)]) {
        const b = boxes.get(inner)
        if (b) next.set(inner, { ...b, x: round(b.x + dx), y: round(b.y + dy) })
      }
    })
    session.gesture(() => {
      writeBoxes(frame, boxes, next)
      hug(ids)
    })
    return true
  }
  const alignTo = (to: Alignment) => arrange((boxes, within) => align(boxes, to, within))
  const distributeAlong = (axis: Distribution) => arrange((boxes) => distribute(boxes, axis))

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
      toggleRulers: () => {
        rulers = !rulers
        drawOverlay()
      },
      toolSelect: () => setTool('select'),
      toolHand: () => setTool('hand'),
      toolRect: () => setTool('rect'),
      toolEllipse: () => setTool('ellipse'),
      toolLine: () => setTool('line'),
      toolArrow: () => setTool('arrow'),
      toolPen: () => setTool('pen'),
      toolText: () => setTool('text'),
    }
    // The pen's path ends with Enter or Escape, open as it is (#45).
    if (pen && (action === 'deselect' || action === 'editPoints')) {
      finishPen()
      return true
    }
    // Enter or Escape ends a crop (#48).
    if (cropping && (action === 'deselect' || action === 'editPoints')) {
      cropping = null
      drawOverlay()
      return true
    }
    if (pathEditing) {
      if (action === 'deselect' || action === 'editPoints') {
        pathEditing = null
        drawOverlay()
        return true
      }
      if (action === 'delete') {
        deletePoints()
        drawOverlay()
        return true
      }
    }
    const viewAction = view[action]
    if (viewAction) {
      if (action === 'undo' || action === 'redo') {
        finishPen()
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
      case 'alignLeft': alignTo('left')
        break
      case 'alignCentre': alignTo('centre')
        break
      case 'alignRight': alignTo('right')
        break
      case 'alignTop': alignTo('top')
        break
      case 'alignMiddle': alignTo('middle')
        break
      case 'alignBottom': alignTo('bottom')
        break
      case 'distributeHorizontal': distributeAlong('horizontal')
        break
      case 'distributeVertical': distributeAlong('vertical')
        break
      case 'editPoints': {
        // Enter on one layer with an image fill crops it (#48); on one path, it goes into its points (#45).
        const [only] = selection.ids
        if (selection.ids.length !== 1 || !only || nodes[only]?.lock?.style) return false
        if (cropTarget(frame, only)) cropping = { id: only, frame: frame.key }
        else if (isPath(session.design(), only)) pathEditing = { id: only, frame: frame.key, selected: [] }
        else return false
        break
      }
      case 'mask': {
        // One layer becomes a mask for the layers after it in its parent, or plain again. Several
        // are grouped first, and the bottom one masks the rest (#48).
        if (ids.length === 1) {
          const on = !nodes[ids[0] ?? '']?.props.mask
          runQuietly(() => session.run('node.mask', { ids, mask: on ? 'alpha' : null }))
          break
        }
        let group = ''
        if (runQuietly(() => session.gesture(() => {
          group = session.run('node.group', { ids })
          const [[bottom] = []] = childrenOf(session.design(), group)
          if (bottom) session.run('node.mask', { ids: [bottom], mask: 'alpha' })
        }))) select([group], frame.key)
        break
      }
      case 'autoLayout': {
        // Auto layout on for the selected frames, or off when every one has it already (#46).
        const frames = ids.filter((id) => nodes[id]?.type === 'frame')
        if (frames.length === 0) return false
        const on = !frames.every((id) => {
          const node = nodes[id]
          return node?.type === 'frame' && node.props.layout !== undefined
        })
        runQuietly(() => session.gesture(() => {
          for (const id of frames) session.run('node.autoLayout', { id, on })
        }))
        break
      }
      case 'booleanUnion': combine('union')
        break
      case 'booleanSubtract': combine('subtract')
        break
      case 'booleanIntersect': combine('intersect')
        break
      case 'booleanExclude': combine('exclude')
        break
      case 'ungroup': {
        // Booleans come apart the same way, their shapes showing their own paints again.
        const groups = ids.filter((id) => nodes[id]?.type === 'group' || nodes[id]?.type === 'boolean')
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
    // The paste event that follows doesn't say whether Shift was down.
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV') pasteAtPointer = e.shiftKey
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
    const range = textRange() ?? { start: 0, end: 0 }
    const caret = Math.min(anchorOffset(doc, editing.caret) ?? 0, text.length)
    const selected = range.end > range.start
    const { id } = editing
    const key = e.key.toLowerCase()
    /** Replaces the selected range with text, or with nothing; the caret ends after what went in. */
    const replace = (inserted: string) => {
      const ok = runQuietly(() => {
        if (selected) session.run('text.edit', { id, op: { kind: 'delete', at: range.start, length: range.end - range.start } })
        if (inserted) session.run('text.edit', { id, op: { kind: 'insert', at: range.start, text: inserted } })
      })
      // The anchor sits after the character before the caret, so inserting at the caret leaves it
      // before the new text; it is moved past it.
      if (ok) caretTo(range.start + inserted.length)
      return ok
    }
    /** The caret's offset on the line above or below, or at the start or end of its line. */
    const lineMove = (to: 'up' | 'down' | 'home' | 'end') => {
      const laid = editingText()
      if (!laid) return caret
      const at = caretPosition(ck, laid.laid, caret)
      if (to === 'home' || to === 'end') return caretAt(ck, laid.laid, to === 'home' ? -1e6 : 1e6, at.y + at.height / 2)
      const y = to === 'up' ? at.y - at.height / 2 : at.y + at.height * 1.5
      if (y < 0) return 0
      if (y > laid.laid.height) return text.length
      return caretAt(ck, laid.laid, at.x, y)
    }
    if (e.key === 'Escape') {
      stopEditing()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Logical order: right-to-left text moves the other way on screen, as most editors do. With
      // a range and no Shift, the caret goes to its near end.
      const forward = e.key === 'ArrowRight'
      if (selected && !e.shiftKey) caretTo(forward ? range.end : range.start)
      else caretTo(step(text, caret, forward), e.shiftKey)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
      caretTo(lineMove(({ ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' } as const)[e.key]), e.shiftKey)
    } else if (mod && key === 'a') {
      selectText({ start: 0, end: text.length })
    } else if (mod && ['b', 'i', 'u'].includes(key) || (mod && e.shiftKey && key === 'x')) {
      // Style keys (#47) style the selected range, in the base, so every format shows it.
      const toggle: StyleToggle = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : 'strikethrough'
      if (selected) runQuietly(() => session.run('text.edit', { id, op: { kind: 'style', at: range.start, length: range.end - range.start, style: toggled(node.props, range, toggle) } }))
    } else if (e.key === 'Backspace' && (selected || caret > 0)) {
      if (selected) replace('')
      else if (runQuietly(() => session.run('text.edit', { id, op: { kind: 'delete', at: step(text, caret, false), length: caret - step(text, caret, false) } }))) caretTo(step(text, caret, false))
    } else if (e.key === 'Delete' && (selected || caret < text.length)) {
      if (selected) replace('')
      else runQuietly(() => session.run('text.edit', { id, op: { kind: 'delete', at: caret, length: step(text, caret, true) - caret } }))
    } else if (e.key === 'Enter') {
      replace('\n')
    } else if (e.key.length > 0 && [...e.key].length === 1 && !mod) {
      // Text is shared by every format, so typing writes the base.
      replace(e.key)
    } else {
      // Copy, cut and paste come as their own events; anything else is the page's.
      return
    }
    e.preventDefault()
    if (session.design().nodes[id] !== node) fitText(id)
    drawOverlay()
  }
  /** The text being edited and its selected range, for the clipboard. */
  function clipboardText() {
    const node = editing && session.design().nodes[editing.id]
    const range = textRange()
    return node?.type === 'text' && range ? { id: node, text: node.props.text, range } : null
  }
  /**
   * The selected layers as a tree for the clipboard (#49), bottom to top with everything inside
   * them, each as the selection's format shows it: placed by auto layout, with the format's overrides.
   */
  function copiedLayers(): LayerClipboard | null {
    const frame = selection && frameOf(selection.frame)
    if (!frame || editing) return null
    const now = session.design()
    const stacked: string[] = []
    const walk = (parentId: string) => {
      for (const [id] of childrenOf(now, parentId)) {
        stacked.push(id)
        walk(id)
      }
    }
    walk(frame.pageId)
    const tops = roots(now).sort((a, b) => stacked.indexOf(a) - stacked.indexOf(b))
    if (tops.length === 0) return null
    const nodes: Record<string, Layer> = {}
    const add = (id: string) => {
      const node = now.nodes[id]
      const box = boxIn(frame, id, now)
      if (!node || !box) return
      nodes[id] = { ...node, props: { ...node.props, ...now.overrides[scope(frame)]?.[id], ...box } } as Layer
      for (const [child] of childrenOf(now, id)) add(child)
    }
    for (const id of tops) add(id)
    return { kind: 'razzlr.layers', schemaVersion: SCHEMA_VERSION, designId: options.designId, tree: { nodes, roots: tops } }
  }
  /**
   * The last layers copied, kept in this browser too with the plain text the copy wrote: a paste
   * that brings that text but not our own type (Mod+Shift+V pastes plain text only, and Safari
   * drops custom types) still pastes the layers.
   */
  const REMEMBERED = 'razzlr.copiedLayers'
  function putOnClipboard(data: DataTransfer, copied: LayerClipboard) {
    const json = JSON.stringify(copied)
    const plain = copied.tree.roots.map((id) => copied.tree.nodes[id]?.name || 'Layer').join('\n')
    data.setData(LAYER_CLIPBOARD_TYPE, json)
    data.setData('text/plain', plain)
    try {
      localStorage.setItem(REMEMBERED, JSON.stringify({ plain, json }))
    } catch {
      // Without storage, only pastes that keep our own type paste layers.
    }
  }
  function layersOnClipboard(data: DataTransfer | null): LayerTree | null {
    let raw = data?.getData(LAYER_CLIPBOARD_TYPE)
    const plain = data?.getData('text/plain')
    try {
      if (!raw && plain) {
        const kept = JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null') as { plain?: string; json?: string } | null
        if (kept?.plain === plain) raw = kept.json
      }
      const parsed = raw ? LayerClipboard.safeParse(JSON.parse(raw)) : null
      return parsed?.success ? parsed.data.tree : null
    } catch {
      return null
    }
  }
  /** Whether the paste being made goes where the pointer is (Mod+Shift+V), not where the layers were. */
  let pasteAtPointer = false
  /**
   * Pastes layers (#49) into the frame the selection is in, or else the one under the pointer: in
   * the group or frame double-clicked into when it can hold them, otherwise on the page, where they
   * were or centred on the pointer. One undo step; the pasted layers end up selected.
   */
  function pasteLayers(tree: LayerTree, atPointer: boolean) {
    const under = pointer ? pointIn(pointer) : null
    const frame = frameOf(selection?.frame) ?? under?.frame ?? drawnFrames[0] ?? grid.frames[0]
    if (!frame) return
    const now = session.design()
    const inside = entered ? now.nodes[entered] : undefined
    const holds = inside && tree.roots.every((root) => canHold(inside.type, tree.nodes[root]?.type ?? ''))
    const parentId = entered && holds && selection?.frame === frame.key ? entered : frame.pageId
    let dx = 0
    let dy = 0
    if (atPointer && under?.frame.key === frame.key) {
      const p = localTo(under.p, containersOf(frame, parentId, now))
      const b = boundsOf(tree.roots.flatMap((root) => {
        const props = tree.nodes[root]?.props
        return props ? [{ x: props.x, y: props.y, width: props.width, height: props.height, rotation: props.rotation }] : []
      }))
      dx = round(p.x - (b.x + b.width / 2))
      dy = round(p.y - (b.y + b.height / 2))
    }
    let pasted: string[] = []
    if (runQuietly(() => session.gesture(() => {
      pasted = session.run('design.place', { parentId, tree, dx, dy })
      if (now.nodes[parentId]) hug([parentId])
    }))) select(pasted, frame.key)
  }

  // Copy, cut and paste plain text while typing (#47), and layers otherwise (#49). Pasted line
  // breaks become paragraphs.
  window.addEventListener('copy', (e) => {
    if (inField(e.target) || !e.clipboardData) return
    const at = clipboardText()
    if (at) {
      if (at.range.end === at.range.start) return
      e.clipboardData.setData('text/plain', at.text.slice(at.range.start, at.range.end))
      e.preventDefault()
      return
    }
    const copied = copiedLayers()
    if (!copied) return
    putOnClipboard(e.clipboardData, copied)
    e.preventDefault()
  }, on)
  window.addEventListener('cut', (e) => {
    if (!editing && !inField(e.target) && e.clipboardData) {
      const copied = copiedLayers()
      if (!copied) return
      putOnClipboard(e.clipboardData, copied)
      e.preventDefault()
      perform('delete')
      return
    }
    const at = clipboardText()
    if (!at || !editing || inField(e.target) || at.range.end === at.range.start) return
    e.clipboardData?.setData('text/plain', at.text.slice(at.range.start, at.range.end))
    e.preventDefault()
    const { id } = editing
    if (runQuietly(() => session.run('text.edit', { id, op: { kind: 'delete', at: at.range.start, length: at.range.end - at.range.start } }))) caretTo(at.range.start)
    fitText(id)
    drawOverlay()
  }, on)
  window.addEventListener('paste', (e) => {
    if (inField(e.target)) return
    if (!editing) {
      // Layers copied in this or another design; anything else on the clipboard isn't ours to paste.
      const tree = layersOnClipboard(e.clipboardData)
      if (!tree) return
      e.preventDefault()
      pasteLayers(tree, pasteAtPointer)
      pasteAtPointer = false
      return
    }
    const at = clipboardText()
    if (!at) return
    const pasted = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
    e.preventDefault()
    const { id } = editing
    const { start, end } = at.range
    const ok = runQuietly(() => {
      if (end > start) session.run('text.edit', { id, op: { kind: 'delete', at: start, length: end - start } })
      if (pasted) session.run('text.edit', { id, op: { kind: 'insert', at: start, text: pasted } })
    })
    if (ok) caretTo(start + pasted.length)
    fitText(id)
    drawOverlay()
  }, on)
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
    /** Calls back with the selected layers whenever the selection changes. */
    onSelection(listener: (ids: string[]) => void) {
      selectionListeners.add(listener)
      return () => selectionListeners.delete(listener)
    },
    /** Whether the rulers along the stage's edges show. */
    rulers: () => rulers,
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
    setTool,
    tool: () => tool,
    /** Calls back with the tool whenever it changes, by a key or after drawing a shape. */
    onTool(listener: (tool: Tool) => void) {
      toolListeners.add(listener)
      return () => toolListeners.delete(listener)
    },
    /** Where a design pixel of one frame is on screen now, in client coordinates; the first page and the primary format by default. */
    screenPoint(x: number, y: number, pageId?: string, formatId?: string): Point {
      const frame = defaultFrame(pageId, formatId)
      const at = toScreen(camera, { x: frame.x + x, y: frame.y + y })
      const rect = canvas.getBoundingClientRect()
      return { x: rect.left + at.x, y: rect.top + at.y }
    },
    /** A layer's box as drawn in one frame, in design pixels, auto layout solved; the first page and the primary format by default. */
    boxOf(id: string, pageId?: string, formatId?: string) {
      const box = drawnBoxOf(defaultFrame(pageId, formatId), id)
      return box && { x: box.x, y: box.y, width: box.width, height: box.height }
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
    /**
     * Exports pages in formats as PNG or JPG, as this tab holds the design now, drawn in the export
     * worker so the stage stays responsive (#55). One file comes as itself, more as one zip.
     */
    async exportFiles(request: ExportRequestInput, progress?: (done: number, total: number) => void) {
      // A family picked a moment ago is drawn in its own font, never the fallback.
      await fontsLoading
      return exporter.run(session.design(), request, resourceBytes, progress)
    },
    /** The families whose files the editor has, shipped ones included (#50). */
    loadedFamilies: () => [...new Set(resourceBytes.fonts.map((f) => f.family))],
    /**
     * Sets the font of the selected text layers, as one undo step (#50): the family, and the weight
     * when one is given. Their files load in the background, and the text redraws when they are here.
     */
    setFont(fontFamily: string, fontWeight?: number) {
      const current = session.design()
      const ids = (selection?.ids ?? []).filter((id) => current.nodes[id]?.type === 'text')
      if (ids.length === 0) return
      session.gesture(() => {
        for (const id of ids) {
          const node = current.nodes[id]
          if (node?.type !== 'text') continue
          const style = { ...node.props.style, fontFamily, ...(fontWeight === undefined ? {} : { fontWeight }) }
          runQuietly(() => session.run('node.update', { ids: [id], patch: { style } }))
        }
      })
    },
    synced: () => provider.synced && provider.unsyncedChanges === 0,
    destroy() {
      listening.abort()
      exporter.destroy()
      resized.disconnect()
      cancelAnimationFrame(pending)
      drawListeners.clear()
      selectionListeners.clear()
      toolListeners.clear()
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
