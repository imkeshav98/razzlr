import type { SceneLayer } from '@dazbee/renderer'
import { describe, expect, it } from 'vitest'
import { hitTest } from './hit-test.ts'

const props = { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, blendMode: 'normal', effects: [], visible: true, locked: false }
const box = (id: string, x: number, y: number, width: number, height: number, rotation = 0) =>
  ({ id, type: 'graphic', props: { ...props, x, y, width, height, rotation, shape: { kind: 'rect' }, strokes: [] }, children: [] }) as unknown as SceneLayer
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

  it('passes over a layer that is not pickable, and everything in it, to what lies beneath', () => {
    const under = box('under', 0, 0, 300, 300)
    const locked = frame('f', true, [box('child', 150, 150, 100, 100)])
    const unlocked = (layer: { id: string }) => layer.id !== 'f'
    expect(hitTest([under, locked], { x: 160, y: 160 }, unlocked)?.id).toBe('under')
    expect(hitTest([under, locked], { x: 160, y: 160 })?.id).toBe('child')
  })

  it('picks a line near it, however thin its box, and a boolean by the shapes inside it (#44)', () => {
    const line = { id: 'line', type: 'graphic', props: { ...props, x: 0, y: 50, width: 200, height: 0, shape: { kind: 'line' }, strokes: [{ width: 6 }] }, children: [] } as unknown as SceneLayer
    // Half the stroke, 3, and 4 more either side.
    expect(hitTest([line], { x: 100, y: 57 })?.id).toBe('line')
    expect(hitTest([line], { x: 100, y: 43 })?.id).toBe('line')
    expect(hitTest([line], { x: 100, y: 58 })).toBeNull()
    expect(hitTest([line], { x: 201, y: 50 })).toBeNull()
    const combined = { id: 'b', type: 'boolean', props: { ...props, width: 300, height: 100 }, children: [box('a', 0, 0, 100, 100), box('c', 200, 0, 100, 100)] } as unknown as SceneLayer
    expect(hitTest([combined], { x: 250, y: 50 })?.id).toBe('c')
    // Between its shapes, nothing: a boolean has no box of its own to click.
    expect(hitTest([combined], { x: 150, y: 50 })).toBeNull()
  })

  it('never picks a mask, and picks what it masks only inside it, up to the next mask', () => {
    const mask = { ...box('mask', 0, 0, 100, 100), props: { ...box('mask', 0, 0, 100, 100).props, mask: 'alpha' } } as SceneLayer
    const layers = [box('under', 0, 0, 300, 300), mask, box('masked', 50, 50, 100, 100), { ...mask, id: 'next', props: { ...mask.props, x: 200 } } as SceneLayer, box('after', 120, 120, 30, 30)]
    expect(hitTest(layers, { x: 75, y: 75 })?.id).toBe('masked')
    // Outside the mask the masked layer isn't there, nor is the mask: what lies under is picked.
    expect(hitTest(layers, { x: 110, y: 110 })?.id).toBe('under')
    expect(hitTest(layers, { x: 10, y: 10 })?.id).toBe('under')
    // The next mask starts a run of its own, which the layer after it is in.
    expect(hitTest(layers, { x: 130, y: 130 })?.id).toBe('under')
    expect(hitTest([box('under', 0, 0, 300, 300), mask, box('masked', 50, 50, 100, 100), box('after', 120, 120, 30, 30)], { x: 130, y: 130 })?.id).toBe('under')
  })
})
