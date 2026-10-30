import type { SceneLayer } from '@razzlr/renderer'
import { describe, expect, it } from 'vitest'
import { hitTest } from './hit-test.ts'

const props = { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blendMode: 'normal', effects: [], visible: true, locked: false }
const box = (id: string, x: number, y: number, width: number, height: number, rotation = 0) =>
  ({ id, type: 'graphic', props: { ...props, x, y, width, height, rotation }, children: [] }) as unknown as SceneLayer
const frame = (id: string, clip: boolean, children: SceneLayer[]) =>
  ({ id, type: 'frame', props: { ...props, width: 200, height: 200, clip }, children }) as unknown as SceneLayer

describe('hitTest', () => {
  it('picks the topmost layer under the point, and nothing over empty page', () => {
    const layers = [box('under', 0, 0, 100, 100), box('over', 50, 50, 100, 100)]
    expect(hitTest(layers, { x: 75, y: 75 })?.id).toBe('over')
    expect(hitTest(layers, { x: 25, y: 25 })?.id).toBe('under')
    expect(hitTest(layers, { x: 400, y: 400 })).toBeNull()
  })

  it('un-rotates the point about the layer centre', () => {
    // A 200×20 bar turned 90° stands upright about its centre (100, 10).
    const bar = [box('bar', 0, 0, 200, 20, 90)]
    expect(hitTest(bar, { x: 100, y: 80 })?.id).toBe('bar')
    expect(hitTest(bar, { x: 180, y: 10 })).toBeNull()
  })

  it('picks the child inside a frame, the frame on its empty part, and hides what a clipping frame cuts off', () => {
    const child = box('child', 150, 150, 100, 100)
    expect(hitTest([frame('f', true, [child])], { x: 160, y: 160 })?.id).toBe('child')
    expect(hitTest([frame('f', true, [child])], { x: 20, y: 20 })?.id).toBe('f')
    expect(hitTest([frame('f', true, [child])], { x: 240, y: 240 })).toBeNull()
    expect(hitTest([frame('f', false, [child])], { x: 240, y: 240 })?.id).toBe('child')
  })
})
