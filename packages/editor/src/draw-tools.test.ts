import { describe, expect, it } from 'vitest'
import { clickedBox, drawnBox, newImage, newShape } from './draw-tools.ts'

describe('drawing a shape (#44)', () => {
  it('spans the drag in any direction, square with Shift, out from the centre with Alt', () => {
    expect(drawnBox('rect', { x: 100, y: 100 }, { x: 40, y: 160 }, false, false)).toEqual({ x: 40, y: 100, width: 60, height: 60, rotation: 0 })
    expect(drawnBox('ellipse', { x: 100, y: 100 }, { x: 180, y: 130 }, true, false)).toEqual({ x: 100, y: 100, width: 80, height: 80, rotation: 0 })
    expect(drawnBox('star', { x: 100, y: 100 }, { x: 70, y: 140 }, true, false)).toEqual({ x: 60, y: 100, width: 40, height: 40, rotation: 0 })
    expect(drawnBox('polygon', { x: 100, y: 100 }, { x: 130, y: 120 }, false, true)).toEqual({ x: 70, y: 80, width: 60, height: 40, rotation: 0 })
  })

  it('draws a line as a box as long as it, turned to its angle, in 45° steps with Shift', () => {
    expect(drawnBox('line', { x: 0, y: 0 }, { x: 30, y: 40 }, false, false)).toEqual({ x: -10, y: 20, width: 50, height: 0, rotation: 53.13 })
    // 10° off the diagonal snaps onto it; the length stays the pointer's distance.
    const snapped = drawnBox('arrow', { x: 0, y: 0 }, { x: 100, y: 70 }, true, false)
    expect(snapped.rotation).toBe(45)
    expect(snapped.width).toBe(122.07)
    // Leftwards is a half turn, not a negative width.
    expect(drawnBox('line', { x: 100, y: 0 }, { x: 0, y: 0 }, false, false)).toEqual({ x: 0, y: 0, width: 100, height: 0, rotation: 180 })
  })

  it('draws a click at the usual size around where it landed', () => {
    expect(clickedBox('rect', { x: 300, y: 200 })).toEqual({ x: 250, y: 150, width: 100, height: 100, rotation: 0 })
    expect(clickedBox('arrow', { x: 300, y: 200 })).toEqual({ x: 250, y: 200, width: 100, height: 0, rotation: 0 })
  })

  it('makes each tool its own shape, with what it needs to show', () => {
    expect(newShape('star').props).toMatchObject({ shape: { kind: 'star' }, fills: [{ type: 'solid' }] })
    expect(newShape('arrow').props).toMatchObject({ shape: { kind: 'line', end: 'arrow' }, strokes: [{ width: 4 }] })
    expect(newShape('line').props).not.toHaveProperty('fills')
  })
})

describe('placing an image from the asset library (#52)', () => {
  const photo = { id: 'a1', name: 'Sneaker.jpg', width: 1920, height: 1200 }

  it('takes at most half the frame, keeps its shape and centres on the point', () => {
    const layer = newImage(photo, { x: 540, y: 540 }, { width: 1080, height: 1080 })
    expect(layer).toEqual({
      type: 'graphic', name: 'Sneaker.jpg',
      props: { x: 270, y: 371, width: 540, height: 338, shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: 'a1', fit: 'fill' }] },
    })
    // A tall frame: the width is what limits it.
    expect(newImage(photo, { x: 0, y: 0 }, { width: 300, height: 1000 }).props).toMatchObject({ width: 150, height: 94 })
  })

  it('keeps a small image at its own size and names an unnamed one Image', () => {
    expect(newImage({ ...photo, name: ' ', width: 40, height: 30 }, { x: 100, y: 100 }, { width: 1080, height: 1080 })).toMatchObject({
      name: 'Image', props: { x: 80, y: 85, width: 40, height: 30 },
    })
  })
})
