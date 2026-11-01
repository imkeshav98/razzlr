'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { SHAPE_TOOLS, startEditor, type Editor, type ShapeTool, type Tool } from '@razzlr/editor'
import { fetchSyncToken } from './actions.ts'
import { EditorShell, type ChromeInsets } from '../../../../../components/editor/shell.tsx'
import { FocusChip, UndoToast } from '../../../../../components/editor/formats-panel.tsx'
import { PropertyCards } from '../../../../../components/editor/property-cards.tsx'
import { ZoomControl } from '../../../../../components/editor/zoom-control.tsx'
import { ASSET_DRAG_TYPE, AssetLibrary, draggedAsset } from '../../../../../components/editor/asset-library.tsx'
import { BrandKitPanel } from '../../../../../components/editor/brand-kit-panel.tsx'
import { ShareMenu } from '../../../../../components/editor/share-menu.tsx'
import { LayersPanel } from '../../../../../components/editor/layers-panel.tsx'
import { BrandKit, brandVariables, FontFamily, type Variables } from '@razzlr/schema'

declare global {
  interface Window { razzlr?: Editor }
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
  const response = await fetch(`/brands/${encodeURIComponent(brandId)}/kit`).catch(() => null)
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

/** The camera's zoom, held outside React state so a zoom step redraws the zoom pill alone. */
function zoomStore() {
  let zoom: number | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => zoom,
    set(next: number | null) {
      if (next === zoom) return
      zoom = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The zoom pill, reading the zoom from the store. */
function StageZoom({ editor, store }: { editor: Editor | null; store: ReturnType<typeof zoomStore> }) {
  const zoom = useSyncExternalStore(store.subscribe, store.get, () => null)
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
  const [status, setStatus] = useState('Starting')
  const [zoom] = useState(zoomStore)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  // The dock follows the editor's tool: a key picks one, and drawing a shape goes back to select.
  const [tool, setEditorTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeTool>('rect')
  useEffect(() => {
    if (!editor) return
    const stop = editor.onTool((next) => {
      setEditorTool(next)
      if ((SHAPE_TOOLS as readonly string[]).includes(next)) setShape(next as ShapeTool)
    })
    return () => {
      stop()
    }
  }, [editor])
  const dockTool = tool === 'hand' || tool === 'select' || tool === 'pen' || tool === 'text' ? tool : 'shape'
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
        ...(variables ? { variables } : {}), ...(formatId ? { formatId } : {}), onStatus: setStatus, onZoom: zoom.set, signal: unmounted.signal,
      }))
      .then((started) => {
        if (unmounted.signal.aborted) return started.destroy()
        editor = started
        window.razzlr = started
        setEditor(started)
        // CanvasKit and the fonts may have loaded before the worker was in charge.
        void keepForOffline()
      })
      .catch((error: unknown) => {
        if (!unmounted.signal.aborted) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      unmounted.abort()
      editor?.destroy()
      delete window.razzlr
      setEditor(null)
      zoom.set(null)
    }
  }, [brandId, designId, formatId, syncUrl, zoom])

  return (
    <EditorShell
      brandId={brandId}
      brandName={brandName}
      designName={designName}
      status={status}
      tool={dockTool}
      shape={shape}
      onToolChange={(tool, picked) => {
        setShape(picked)
        editor?.setTool(tool === 'hand' || tool === 'pen' || tool === 'text' ? tool : tool === 'shape' ? picked : 'select')
      }}
      onInsets={onInsets}
      fitted={editor !== null && fittedTo === editor}
      actions={editor ? <ShareMenu editor={editor} brandId={brandId} brandName={brandName} designName={designName} everyBrand={everyBrand} /> : undefined}
      account={account}
      panels={editor ? { layers: <LayersPanel editor={editor} />, assets: <AssetLibrary editor={editor} brandId={brandId} />, brand: <BrandKitPanel editor={editor} brandId={brandId} /> } : {}}
      inspector={editor ? <PropertyCards editor={editor} brandId={brandId} onRemoved={setRemoved} /> : undefined}
    >
      {/* The design is a picture, so it never mirrors: the stage stays left to right in Arabic too. */}
      {/* An asset dragged from the library lands where it is dropped (#52). */}
      <div
        dir="ltr"
        className="absolute inset-0"
        onDragOver={(e) => {
          if (!editor || !e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          const asset = editor && draggedAsset(e)
          if (!asset) return
          e.preventDefault()
          editor.placeImage(asset, { x: e.clientX, y: e.clientY })
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
