// Reads where a PDF draws each glyph, to check its text sits where the renderer put it (#56). It
// knows as much PDF as Skia writes: plain objects, Flate streams, Type0 fonts with two-byte glyph
// ids, and form XObjects for layers.
import { inflateSync } from 'node:zlib'

/** One glyph as the PDF draws it, in the page's own coordinates (y down, as the renderer has them). */
export interface PdfGlyph {
  glyph: number
  x: number
  y: number
}

type Value = number | string | Value[] | { [key: string]: Value } | { ref: number } | { hex: string }
type Dict = { [key: string]: Value }
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** a then b, in PDF's row-vector order. */
const times = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
]

const DELIMITER = /[\s()<>[\]{}/%]/

/** Splits PDF syntax into values and operators. */
function* tokens(text: string): Generator<Value | { op: string }> {
  let i = 0
  const stack: Value[][] = []
  const dicts: number[] = []
  const emit = function* (value: Value): Generator<Value | { op: string }> {
    const top = stack.at(-1)
    if (top) top.push(value)
    else yield value
  }
  while (i < text.length) {
    const c = text[i] as string
    if (/\s/.test(c)) { i++; continue }
    if (c === '%') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '[') { stack.push([]); i++; continue }
    if (c === ']') { const done = stack.pop() ?? []; i++; yield* emit(done); continue }
    if (text.startsWith('<<', i)) { dicts.push(stack.length); stack.push([]); i += 2; continue }
    if (text.startsWith('>>', i)) {
      dicts.pop()
      const flat = stack.pop() ?? []
      const dict: Dict = {}
      for (let k = 0; k + 1 < flat.length; k += 2) dict[String(flat[k]).slice(1)] = flat[k + 1] as Value
      i += 2
      yield* emit(dict)
      continue
    }
    if (c === '<') { const end = text.indexOf('>', i); yield* emit({ hex: text.slice(i + 1, end).replace(/\s/g, '') }); i = end + 1; continue }
    if (c === '(') {
      let depth = 0
      let j = i
      for (; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue }
        if (text[j] === '(') depth++
        if (text[j] === ')' && --depth === 0) break
      }
      yield* emit(text.slice(i + 1, j))
      i = j + 1
      continue
    }
    let j = i + 1
    while (j < text.length && !DELIMITER.test(text[j] as string)) j++
    const word = text.slice(i, j)
    i = j
    if (c === '/') { yield* emit(word); continue }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { yield* emit(Number(word)); continue }
    if (word === 'R' && stack.length > 0) {
      // "n 0 R" inside an array or dictionary: a reference.
      const top = stack.at(-1) as Value[]
      top.pop()
      top.push({ ref: top.pop() as number })
      continue
    }
    if (stack.length > 0) { yield* emit(word); continue }
    yield { op: word }
  }
}

interface PdfObject { dict: Dict; stream?: string }

/** Every object in a PDF Skia wrote, by number, with its stream inflated. */
function objects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = Buffer.from(bytes).toString('latin1')
  const found = new Map<number, PdfObject>()
  for (const match of text.matchAll(/(\d+) 0 obj\s*/g)) {
    const start = (match.index ?? 0) + match[0].length
    if (!text.startsWith('<<', start)) continue
    let depth = 0
    let end = start
    for (; end < text.length; end++) {
      if (text.startsWith('<<', end)) { depth++; end++; continue }
      if (text.startsWith('>>', end)) {
        if (--depth === 0) { end += 2; break }
        end++
      }
    }
    const [dict] = [...tokens(text.slice(start, end))] as Dict[]
    if (!dict) continue
    const object: PdfObject = { dict }
    const after = text.slice(end).match(/^\s*stream\r?\n/)
    if (after) {
      const from = end + after[0].length
      const raw = Buffer.from(text.slice(from, from + Number(dict.Length)), 'latin1')
      object.stream = (dict.Filter === '/FlateDecode' ? inflateSync(raw) : raw).toString('latin1')
    }
    found.set(Number(match[1]), object)
  }
  return found
}

/** Glyph widths of a Type0 font, in thousandths of the font size, from its CID font's /W. */
function widthsOf(font: Dict, resolve: (v: Value | undefined) => Value | undefined) {
  const descendant = resolve((resolve(font.DescendantFonts) as Value[] | undefined)?.[0]) as Dict | undefined
  const widths = new Map<number, number>()
  const list = (resolve(descendant?.W) as Value[] | undefined) ?? []
  for (let i = 0; i < list.length;) {
    const first = list[i] as number
    const next = list[i + 1]
    if (Array.isArray(next)) {
      next.forEach((w, k) => widths.set(first + k, w as number))
      i += 2
    } else {
      for (let g = first; g <= (next as number); g++) widths.set(g, list[i + 2] as number)
      i += 3
    }
  }
  return { widths, fallback: Number(resolve(descendant?.DW) ?? 1000) }
}

/** Every glyph a one-page PDF draws, layers included, where it draws it. */
export function pdfGlyphs(bytes: Uint8Array): PdfGlyph[] {
  const all = objects(bytes)
  const resolve = (v: Value | undefined): Value | undefined =>
    v && typeof v === 'object' && 'ref' in v ? all.get((v as { ref: number }).ref)?.dict : v
  const page = [...all.values()].find((o) => o.dict.Type === '/Page')
  if (!page) throw new Error('the PDF has no page')
  const box = resolve(page.dict.MediaBox) as number[]
  const height = (box[3] ?? 0) - (box[1] ?? 0)
  const glyphs: PdfGlyph[] = []

  const run = (stream: string, resources: Dict, start: Matrix) => {
    let ctm = start
    const saved: Matrix[] = []
    let tm = IDENTITY
    let line = IDENTITY
    let font: { size: number; widths: Map<number, number>; fallback: number; twoByte: boolean } | null = null
    const operands: Value[] = []
    const show = (hex: string) => {
      if (!font) return
      const step = font.twoByte ? 4 : 2
      for (let k = 0; k < hex.length; k += step) {
        const glyph = parseInt(hex.slice(k, k + step), 16)
        const [, , , , x, y] = times(tm, ctm)
        glyphs.push({ glyph, x, y: height - y })
        const advance = ((font.widths.get(glyph) ?? font.fallback) / 1000) * font.size
        tm = times([1, 0, 0, 1, advance, 0], tm)
      }
    }
    for (const token of tokens(stream)) {
      if (!(typeof token === 'object' && token !== null && 'op' in token)) {
        operands.push(token as Value)
        continue
      }
      const args = operands.splice(0)
      const n = (k: number) => Number(args[k])
      switch (token.op) {
        case 'q': saved.push(ctm); break
        case 'Q': ctm = saved.pop() ?? IDENTITY; break
        case 'cm': ctm = times([n(0), n(1), n(2), n(3), n(4), n(5)], ctm); break
        case 'BT': tm = IDENTITY; line = IDENTITY; break
        case 'Tm': tm = [n(0), n(1), n(2), n(3), n(4), n(5)]; line = tm; break
        case 'Td': line = times([1, 0, 0, 1, n(0), n(1)], line); tm = line; break
        case 'Tf': {
          const dict = resolve((resolve(resources.Font) as Dict | undefined)?.[String(args[0]).slice(1)]) as Dict | undefined
          font = dict ? { size: n(1), twoByte: dict.Subtype === '/Type0', ...widthsOf(dict, resolve) } : null
          break
        }
        case 'Tj': show((args[0] as { hex: string }).hex ?? ''); break
        case 'TJ':
          for (const part of args[0] as Value[]) {
            if (typeof part === 'number') tm = times([1, 0, 0, 1, (-part / 1000) * (font?.size ?? 0), 0], tm)
            else show((part as { hex: string }).hex ?? '')
          }
          break
        case 'Do': {
          const ref = (resolve(resources.XObject) as Dict | undefined)?.[String(args[0]).slice(1)] as { ref: number } | undefined
          const form = ref && all.get(ref.ref)
          if (form?.stream && form.dict.Subtype === '/Form') {
            const matrix = (resolve(form.dict.Matrix) as number[] | undefined) ?? IDENTITY
            run(form.stream, (resolve(form.dict.Resources) as Dict | undefined) ?? {}, times(matrix as Matrix, ctm))
          }
          break
        }
      }
    }
  }

  const contents = page.dict.Contents
  const refs = (Array.isArray(contents) ? contents : [contents]) as { ref: number }[]
  const stream = refs.map((r) => all.get(r.ref)?.stream ?? '').join('\n')
  run(stream, (resolve(page.dict.Resources) as Dict | undefined) ?? {}, IDENTITY)
  return glyphs
}
