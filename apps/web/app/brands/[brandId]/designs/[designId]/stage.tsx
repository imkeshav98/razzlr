'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SHAPE_TOOLS, startEditor, type Editor, type ShapeTool, type Tool } from '@dazbee/editor'
import { fetchSyncToken, renameFromEditor } from './actions.ts'
import { EditorShell, type ChromeInsets } from '../../../../../components/editor/shell.tsx'
import { FocusChip, UndoToast } from '../../../../../components/editor/formats-panel.tsx'
import { PropertyCards } from '../../../../../components/editor/property-cards.tsx'
import { ZoomControl } from '../../../../../components/editor/zoom-control.tsx'
import { ASSET_DRAG_TYPE, AssetLibrary, draggedAsset } from '../../../../../components/editor/asset-library.tsx'
import { BrandKitPanel } from '../../../../../components/editor/brand-kit-panel.tsx'
import { ShareMenu } from '../../../../../components/editor/share-menu.tsx'
import { LayersPanel } from '../../../../../components/editor/layers-panel.tsx'
import { BrandKit, brandVariables, FontFamily, type Variables } from '@dazbee/schema'
import { useValue, valueStore, type ValueStore } from '../../../../../lib/value-store.ts'

/** The editor's tools that the dock shows as the one shape button. */
const isShapeTool = (tool: Tool): tool is ShapeTool => (SHAPE_TOOLS as readonly string[]).includes(tool)

declare global {
  interface Window { dazbee?: Editor }
}

async function assetBytes(brandId: string, assetId: string) {
  const response = await fetch(`/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`)
  if (!response.ok) throw new Error(`asset ${assetId}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The files of the families the editor asks for (#50), from the brand's catalog: fetched once, and
 * again when a family isn't in it yet, as after an upload.
 */
function fontLoader(brandId: string) {
  const brand = `/brands/${encodeURIComponent(brandId)}/fonts`
  let catalog: Promise<FontFamily[]> | null = null
  const fetchCatalog = async () => {
    const response = await fetch(brand)
    if (!response.ok) throw new Error(`fonts: ${response.status}`)
    return FontFamily.array().parse(await response.json())
  }
  return async (families: string[]) => {
    let known = await (catalog ??= fetchCatalog()).catch((error: unknown) => {
      catalog = null
      throw error
    })
    if (families.some((family) => !known.some((f) => f.family === family))) known = await (catalog = fetchCatalog())
    const faces = known.filter((f) => families.includes(f.family)).flatMap((f) => f.faces)
    return Promise.all(faces.map(async (face) => {
      const response = await fetch(`${brand}/${encodeURIComponent(face.id)}`)
      if (!response.ok) throw new Error(`font ${face.family} ${face.weight}: ${response.status}`)
      return { family: face.family, bytes: new Uint8Array(await response.arrayBuffer()) }
    }))
  }
}

/**
 * The values of the brand kit's tokens (#53), for layers bound to them. Without a connection the
 * editor starts without them, and bound layers keep the values they were bound with.
 */
async function brandKitVariables(brandId: string): Promise<Variables | undefined> {
  const response = await fetch(`/brands/${encodeURIComponent(brandId)}/kit/data`).catch(() => null)
  if (!response?.ok) return undefined
  return brandVariables(BrandKit.parse(await response.json()))
}

/** Asks the offline worker to keep this page and everything it has loaded so far. */
async function keepForOffline() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const urls = [location.href, ...performance.getEntriesByType('resource').map((entry) => entry.name)]
  registration.active?.postMessage({ type: 'keep', urls })
}

/** The zoom pill, reading the zoom from the store. */
function StageZoom({ editor, store }: { editor: Editor | null; store: ValueStore<number | null> }) {
  const zoom = useValue(store)
  return (
    <ZoomControl
      zoom={editor ? zoom : null}
      onZoomIn={() => editor?.zoomIn()}
      onZoomOut={() => editor?.zoomOut()}
      onFit={() => editor?.fitAll()}
    />
  )
}

export function EditorStage({ designId, designName, brandId, brandName, everyBrand, formatId, syncUrl, account }: {
  designId: string
  designName: string
  brandId: string
  brandName: string
  /** How the workspace says "every brand", for a template's scope (#54). */
  everyBrand: string
  formatId: string | undefined
  syncUrl: string
  /** The account avatar and its menu, at the top end after Share. */
  account?: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  // The name as last saved from the crumb, so it shows at once without reloading the page.
  const [name, setName] = useState(designName)
  // The save state and zoom change on every edit and zoom step; held outside this component's state,
  // they re-render the status and the zoom pill alone, not the whole editor.
  const [status] = useState(() => valueStore('Starting'))
  const [zoom] = useState(() => valueStore<number | null>(null))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  // The dock follows the editor's tool: a key picks one, and drawing a shape goes back to select.
  const [tool, setEditorTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeTool>('rect')
  // The image tool's picker shows until an image is picked; any other tool forgets the pick.
  const [imagePicked, setImagePicked] = useState(false)
  useEffect(() => {
    if (!editor) return
    const stop = editor.onTool((next) => {
      setEditorTool(next)
      if (next !== 'image') setImagePicked(false)
      if (isShapeTool(next)) setShape(next)
    })
    return () => {
      stop()
    }
  }, [editor])
  const dockTool = isShapeTool(tool) ? 'shape' : tool
  const dismissRemoved = useCallback(() => setRemoved(null), [])

  // The stage's edges the capsule, cards and dock cover (#83): the editor fits the ads between
  // them. The first time they are known the design is fitted again, since it opened fitted to the
  // whole stage. The editor counts as ready only after that, so nothing set on its camera (or
  // read from it) before then is undone by the fit.
  const [chrome, setChrome] = useState<{ insets: ChromeInsets; withCards: boolean } | null>(null)
  const onInsets = useCallback((insets: ChromeInsets, withCards: boolean) => setChrome({ insets, withCards }), [])
  const [fittedTo, setFittedTo] = useState<Editor | null>(null)
  useEffect(() => {
    if (!editor || !chrome) return
    editor.setInsets(chrome.insets)
    // Measured before the cards were in, the insets would fit the design under them.
    if (chrome.withCards && fittedTo !== editor) {
      editor.fitAll()
      setFittedTo(editor)
    }
  }, [editor, chrome, fittedTo])

  // Lets this page open again without a connection (#37): the worker keeps the page and what it
  // loaded, and the design itself is in IndexedDB.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // In development the worker would keep serving the chunks from before an edit, so it is
    // never used there, and one left from a production build is removed.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((r) => r.unregister())))
      return
    }
    navigator.serviceWorker.register('/sw.js').then(keepForOffline).catch(() => {
      // Without the worker the editor still works online; only reopening offline is lost.
    })
  }, [])

  useEffect(() => {
    if (!canvas.current || !overlay.current) return
    let editor: Editor | undefined
    const unmounted = new AbortController()
    const [stage, layer] = [canvas.current, overlay.current]
    brandKitVariables(brandId)
      .then((variables) => startEditor({
        canvas: stage, overlay: layer, designId, syncUrl,
        syncToken: () => fetchSyncToken(brandId, designId), assetBytes: (assetId) => assetBytes(brandId, assetId), fontFiles: fontLoader(brandId),
        ...(variables ? { variables } : {}), ...(formatId ? { formatId } : {}), onStatus: status.set, onZoom: zoom.set, signal: unmounted.signal,
      }))
      .then((started) => {
        if (unmounted.signal.aborted) return started.destroy()
        editor = started
        window.dazbee = started
        setEditor(started)
        // CanvasKit and the fonts may have loaded before the worker was in charge.
        void keepForOffline()
      })
      .catch((error: unknown) => {
        if (!unmounted.signal.aborted) status.set(`Error: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      unmounted.abort()
      editor?.destroy()
      delete window.dazbee
      setEditor(null)
      zoom.set(null)
    }
  }, [brandId, designId, formatId, syncUrl, status, zoom])

  return (
    <EditorShell
      brandId={brandId}
      brandName={brandName}
      designName={name}
      onRename={async (next) => setName(await renameFromEditor(brandId, designId, next))}
      status={status}
      tool={dockTool}
      shape={shape}
      onToolChange={(tool, picked) => {
        setShape(picked)
        // Pressing the image tool again asks for another image.
        if (tool === 'image') {
          editor?.armImage(null)
          setImagePicked(false)
        }
        editor?.setTool(tool === 'shape' ? picked : tool)
      }}
      image={{
        picking: !imagePicked,
        onPick: (asset) => {
          editor?.armImage(asset)
          setImagePicked(true)
        },
      }}
      onInsets={onInsets}
      fitted={editor !== null && fittedTo === editor}
      actions={editor ? <ShareMenu editor={editor} brandId={brandId} brandName={brandName} designName={name} everyBrand={everyBrand} /> : undefined}
      account={account}
      panels={editor ? { layers: <LayersPanel editor={editor} />, assets: <AssetLibrary editor={editor} brandId={brandId} />, brand: <BrandKitPanel editor={editor} brandId={brandId} /> } : {}}
      inspector={editor ? <PropertyCards editor={editor} brandId={brandId} onRemoved={setRemoved} /> : undefined}
    >
      {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
      {/* An asset dragged from the library lands where it is dropped (#52): into the shape it is
          dropped on, lit while it is over it, or as a new layer. */}
      <div
        dir="ltr"
        className="absolute inset-0"
        onDragOver={(e) => {
          if (!editor || !e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          editor.imageTarget({ x: e.clientX, y: e.clientY })
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) editor?.imageTarget(null)
        }}
        onDrop={(e) => {
          const asset = editor && draggedAsset(e)
          if (!asset) return
          e.preventDefault()
          const into = editor.imageTarget({ x: e.clientX, y: e.clientY })
          if (!into || !editor.fillWithImage(into, asset)) editor.placeImage(asset, { x: e.clientX, y: e.clientY })
          editor.imageTarget(null)
        }}
      >
        <canvas ref={canvas} className="block size-full touch-none" data-testid="stage" />
        <div ref={overlay} className="stage-overlay pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
        <div data-slot="mini-bar" className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          {editor && <FocusChip editor={editor} />}
        </div>
        <div className="pointer-events-none absolute start-4 bottom-4 z-10">
          {editor && removed && <UndoToast key={removed} editor={editor} message={removed} onDone={dismissRemoved} />}
        </div>
      </div>
      <StageZoom editor={editor} store={zoom} />
    </EditorShell>
  )
}
