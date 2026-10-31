// A zip of files stored as they are: PNG and JPG are compressed already, so deflating them again
// would only cost time. Every entry gets the same fixed date, so the same files always give the
// same bytes, in the browser and in Node.

export interface ZipEntry { path: string; bytes: Uint8Array }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 1980-01-01 00:00, the first date a zip can hold. */
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1
/** Bit 11: names are UTF-8. */
const UTF8 = 0x0800

export function zip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const names = entries.map((e) => encoder.encode(e.path))
  const crcs = entries.map((e) => crc32(e.bytes))
  const localSize = entries.reduce((sum, e, i) => sum + 30 + (names[i]?.length ?? 0) + e.bytes.length, 0)
  const directorySize = names.reduce((sum, name) => sum + 46 + name.length, 0)
  const out = new Uint8Array(localSize + directorySize + 22)
  const view = new DataView(out.buffer)
  let at = 0
  const u16 = (v: number) => { view.setUint16(at, v, true); at += 2 }
  const u32 = (v: number) => { view.setUint32(at, v, true); at += 4 }
  const put = (bytes: Uint8Array) => { out.set(bytes, at); at += bytes.length }

  const offsets: number[] = []
  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array()
    offsets.push(at)
    u32(0x04034b50); u16(20); u16(UTF8); u16(0); u16(DOS_TIME); u16(DOS_DATE)
    u32(crcs[i] ?? 0); u32(entry.bytes.length); u32(entry.bytes.length); u16(name.length); u16(0)
    put(name)
    put(entry.bytes)
  })
  const central = at
  entries.forEach((entry, i) => {
    const name = names[i] ?? new Uint8Array()
    u32(0x02014b50); u16(20); u16(20); u16(UTF8); u16(0); u16(DOS_TIME); u16(DOS_DATE)
    u32(crcs[i] ?? 0); u32(entry.bytes.length); u32(entry.bytes.length); u16(name.length); u16(0); u16(0)
    u16(0); u16(0); u32(0); u32(offsets[i] ?? 0)
    put(name)
  })
  const centralSize = at - central
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length)
  u32(centralSize); u32(central); u16(0)
  return out
}

/** The entries of a zip this module wrote, stored and not deflated; for checks of what it made. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('not a zip, or it has a comment')
  const count = view.getUint16(end + 10, true)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let at = view.getUint32(end + 16, true)
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory')
    if (view.getUint16(at + 10, true) !== 0) throw new Error('only stored entries are read')
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.slice(start, start + size)
    if (crc32(data) !== view.getUint32(at + 16, true)) throw new Error(`${path}: CRC does not match`)
    entries.push({ path, bytes: data })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}
