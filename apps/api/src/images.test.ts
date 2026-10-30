import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readImageHeader } from './images.ts'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** A real, decodable RGBA PNG whose colours come from `seed`, so different seeds give different bytes. */
export function png(width: number, height: number, seed: string): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc(height * (1 + width * 4))
  for (let i = 0; i < rows.length; i++) rows[i] = i % (1 + width * 4) === 0 ? 0 : (seed.charCodeAt(i % seed.length) * (i + 7)) & 0xff
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]))
}

describe('image headers', () => {
  it('reads a PNG', () => {
    expect(readImageHeader(png(37, 12, 'x'))).toEqual({ contentType: 'image/png', width: 37, height: 12 })
  })

  it('reads a JPEG past its other markers', () => {
    const jpeg = new Uint8Array(readFileSync(join(import.meta.dirname, '../../../tests/pixels/assets/sneaker.jpg')))
    expect(readImageHeader(jpeg)).toMatchObject({ contentType: 'image/jpeg', width: expect.any(Number), height: expect.any(Number) })
  })

  it('reads each kind of WebP', () => {
    const riff = (chunkName: string, body: number[]) => new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from(chunkName), 0, 0, 0, 0, ...body, ...new Array(20).fill(0)])
    // VP8X: 24-bit width and height minus one at bytes 24 and 27.
    expect(readImageHeader(riff('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]))).toEqual({ contentType: 'image/webp', width: 100, height: 50 })
    // VP8L: signature byte, then 14-bit width and height minus one.
    const bits = (300 - 1) | ((200 - 1) << 14)
    expect(readImageHeader(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]))).toEqual({ contentType: 'image/webp', width: 300, height: 200 })
  })

  it('refuses what is not an image, or claims an absurd size', () => {
    expect(readImageHeader(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull()
    expect(readImageHeader(png(20_000, 1, 'x'))).toBeNull()
  })
})
