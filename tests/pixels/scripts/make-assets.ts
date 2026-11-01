// Draws the stand-in photos the fixtures name and saves them as JPEG in assets/.
// They are committed; rerun only to change them: node scripts/make-assets.ts [name ...] (only those named).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Canvas, CanvasKit } from '@dazbee/canvaskit'

const ck: CanvasKit = await loadCanvasKit()
const ASSETS_DIR = join(import.meta.dirname, '..', 'assets')

type Painter = (canvas: Canvas, w: number, h: number) => void

const paint = (setup: (p: InstanceType<CanvasKit['Paint']>) => void) => {
  const p = new ck.Paint()
  p.setAntiAlias(true)
  setup(p)
  return p
}
const linear = (x0: number, y0: number, x1: number, y1: number, colors: string[]) =>
  ck.Shader.MakeLinearGradient([x0, y0], [x1, y1], colors.map((c) => ck.parseColorString(c)), null, ck.TileMode.Clamp)
const radial = (x: number, y: number, r: number, colors: string[]) =>
  ck.Shader.MakeRadialGradient([x, y], r, colors.map((c) => ck.parseColorString(c)), null, ck.TileMode.Clamp)

const studio = (top: string, bottom: string, spot: string): Painter => (canvas, w, h) => {
  canvas.drawPaint(paint((p) => p.setShader(linear(0, 0, 0, h, [top, bottom]))))
  canvas.drawPaint(paint((p) => p.setShader(radial(w * 0.5, h * 0.45, h * 0.7, [spot, 'rgba(255,255,255,0)']))))
  canvas.drawOval(ck.XYWHRect(w * 0.18, h * 0.78, w * 0.64, h * 0.08), paint((p) => {
    p.setColor(ck.Color(0, 0, 0, 0.25))
    p.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 18, true))
  }))
}

const sneaker: Painter = (canvas, w, h) => {
  studio('#FFE8D1', '#F2B48C', 'rgba(255,255,255,0.8)')(canvas, w, h)
  const s = h / 1200
  canvas.save()
  canvas.translate(w * 0.2, h * 0.3)
  canvas.scale(s, s)
  const sole = ck.Path.MakeFromSVGString('M0 520 C 40 600 1100 640 1180 560 L 1180 500 L 0 470 Z')
  const upper = ck.Path.MakeFromSVGString('M40 480 C 60 300 260 180 420 170 C 520 250 640 300 820 320 C 1020 340 1160 420 1180 500 L 40 500 Z')
  const swoosh = ck.Path.MakeFromSVGString('M300 420 C 520 470 820 420 1060 330 C 860 470 560 520 300 420 Z')
  if (!sole || !upper || !swoosh) throw new Error('bad sneaker path')
  canvas.drawPath(upper, paint((p) => p.setShader(linear(0, 170, 0, 500, ['#2E6BFF', '#123A9C']))))
  canvas.drawPath(sole, paint((p) => p.setColor(ck.parseColorString('#F7F7F2'))))
  canvas.drawPath(swoosh, paint((p) => p.setColor(ck.parseColorString('#FF5A36'))))
  for (let i = 0; i < 6; i++) {
    canvas.drawCircle(470 + i * 46, 250 + i * 18, 9, paint((p) => p.setColor(ck.parseColorString('#FFFFFF'))))
  }
  canvas.restore()
}

const card = (top: string, bottom: string, shape: string): Painter => (canvas, w, h) => {
  studio(top, bottom, 'rgba(255,255,255,0.6)')(canvas, w, h)
  canvas.drawCircle(w * 0.5, h * 0.48, Math.min(w, h) * 0.26, paint((p) => p.setShader(radial(w * 0.44, h * 0.4, Math.min(w, h) * 0.3, ['#FFFFFF', shape]))))
  canvas.drawRect(ck.XYWHRect(w * 0.08, h * 0.08, w * 0.12, h * 0.02), paint((p) => p.setColor(ck.parseColorString(shape))))
}

/** A small repeating tile, for the tile fit (#48): a dot on a two-tone ground, cut by a stripe. */
const pattern: Painter = (canvas, w, h) => {
  canvas.drawPaint(paint((p) => p.setColor(ck.parseColorString('#FFD23F'))))
  canvas.drawRect(ck.XYWHRect(0, 0, w / 2, h / 2), paint((p) => p.setColor(ck.parseColorString('#FF48B0'))))
  canvas.drawRect(ck.XYWHRect(w / 2, h / 2, w / 2, h / 2), paint((p) => p.setColor(ck.parseColorString('#3D6BFF'))))
  canvas.drawCircle(w / 2, h / 2, w * 0.18, paint((p) => p.setColor(ck.parseColorString('#15121A'))))
}

const assets: Record<string, [number, number, Painter]> = {
  sneaker: [1920, 1200, sneaker],
  'card-1': [1600, 1040, card('#E3F2FD', '#90CAF9', '#1E88E5')],
  'card-2': [1600, 1040, card('#FCE4EC', '#F48FB1', '#D81B60')],
  'card-3': [1600, 1040, card('#E8F5E9', '#A5D6A7', '#43A047')],
  'card-1-tall': [1200, 1000, card('#E3F2FD', '#90CAF9', '#1E88E5')],
  tile: [120, 120, pattern],
}

const only = process.argv.slice(2)
for (const [id, [w, h, draw]] of Object.entries(assets)) {
  if (only.length > 0 && !only.includes(id)) continue
  const surface = ck.MakeSurface(w, h)
  if (!surface) throw new Error(`no ${w}×${h} surface`)
  draw(surface.getCanvas(), w, h)
  const jpeg = surface.makeImageSnapshot().encodeToBytes(ck.ImageFormat.JPEG, 82)
  if (!jpeg) throw new Error(`could not encode ${id}`)
  writeFileSync(join(ASSETS_DIR, `${id}.jpg`), jpeg)
  surface.delete()
  console.log(`${id}.jpg ${w}×${h} ${jpeg.length} bytes`)
}
