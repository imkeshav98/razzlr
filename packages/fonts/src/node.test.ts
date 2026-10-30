import { describe, expect, it } from 'vitest'
import { FONT_FACES } from './index.ts'
import { loadFontFiles } from './node.ts'

describe('loadFontFiles', () => {
  it('reads every face from the package, as TrueType bytes', () => {
    const faces = loadFontFiles()
    expect(faces.map((f) => f.file)).toEqual(FONT_FACES.map((f) => f.file))
    for (const face of faces) expect([...face.bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0])
  })
})
