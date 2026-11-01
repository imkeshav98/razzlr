import { parseDesign } from '@dazbee/schema'
import { describe, expect, it } from 'vitest'
import { loadDesign, readDesign } from './index.ts'
import { testDesign } from './test-design.ts'

const parsed = () => {
  const result = parseDesign(testDesign())
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

describe('design document', () => {
  it('reads back exactly the design it was loaded with', () => {
    const doc = loadDesign(parsed())
    expect(readDesign(doc)).toEqual(parsed())
  })
})
