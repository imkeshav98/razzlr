// CanvasKit's own types (canvaskit.d.ts, from npm's canvaskit-wasm 0.42.0, the same Skia commit)
// plus the PDF and SVG documents our build adds (build/vector_bindings.cpp).
import type { Canvas, CanvasKit as BaseCanvasKit, CanvasKitInitOptions, EmbindObject } from './canvaskit'

export * from './canvaskit'

/** Document information a PDF carries, and how it stores what vectors can't hold. */
export interface PDFOptions {
  title: string
  author: string
  creator: string
  producer: string
  /** The document's language, such as `en` or `ar`. */
  lang: string
  /** Resolution Skia draws blurs, shadows and other effects it can't keep as vectors at. */
  rasterDPI: number
  /** JPEG quality for opaque images, or 101 to store every image losslessly. */
  encodingQuality: number
}

/** A PDF being written. Each page is drawn on its own Canvas, which belongs to the document. */
export interface PDFDocument extends EmbindObject<'PDFDocument'> {
  /** Starts a page of the size given in PDF points; null once the document is closed. */
  beginPage(width: number, height: number): Canvas | null
  endPage(): void
  /** Finishes the file and returns its bytes; null when it was already closed. */
  close(): Uint8Array | null
}

/** An SVG being written. Its Canvas belongs to the document. */
export interface SVGDocument extends EmbindObject<'SVGDocument'> {
  canvas(): Canvas | null
  /** Finishes the file and returns its bytes; null when it was already closed. */
  close(): Uint8Array | null
}

export interface CanvasKit extends BaseCanvasKit {
  readonly PDFDocument: new (options: PDFOptions) => PDFDocument
  /** An SVG of the size given, with `SVG_*` flags or 0. */
  readonly SVGDocument: new (width: number, height: number, flags: number) => SVGDocument
  readonly SVG_CONVERT_TEXT_TO_PATHS: number
  readonly SVG_NO_PRETTY_XML: number
  readonly SVG_RELATIVE_PATH_ENCODING: number
}

export default function CanvasKitInit(opts?: CanvasKitInitOptions): Promise<CanvasKit>
