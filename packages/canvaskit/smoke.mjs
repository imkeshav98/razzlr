// Checks a CanvasKit build in Node: it loads, draws a scene with text onto a PDF and an SVG canvas,
// and still encodes PNG, JPEG and WebP like npm's full build. Writes smoke.pdf and smoke.svg beside it.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, 'bin'))
const ck = await createRequire(import.meta.url)(join(dir, 'canvaskit.js'))({ locateFile: (file) => join(dir, file) })

function drawScene(canvas) {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.Color(255, 72, 176))
  canvas.drawRect(ck.XYWHRect(20, 20, 160, 100), paint)
  paint.setColor(ck.Color(61, 107, 255))
  canvas.drawCircle(200, 140, 40, paint)
  const font = new ck.Font(ck.Typeface.GetDefault(), 24)
  paint.setColor(ck.BLACK)
  canvas.drawText('Hello PDF', 30, 180, paint, font)
  font.delete()
  paint.delete()
}

const failures = []
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : failures.push(what) && console.log(`FAIL ${what}`))

const pdf = new ck.PDFDocument({ title: 'Smoke', author: '', creator: '', producer: '', lang: 'en', rasterDPI: 300, encodingQuality: 101 })
drawScene(pdf.beginPage(256, 256))
pdf.endPage()
const pdfBytes = pdf.close()
pdf.delete()
const pdfText = Buffer.from(pdfBytes).toString('latin1')
check(pdfText.startsWith('%PDF-'), `PDF starts with %PDF- (${pdfBytes.length} bytes)`)
check(pdfText.includes('/FontFile'), 'PDF embeds its font')
writeFileSync(join(dir, 'smoke.pdf'), pdfBytes)

const svg = new ck.SVGDocument(256, 256, 0)
drawScene(svg.canvas())
const svgText = new TextDecoder().decode(svg.close())
svg.delete()
check(svgText.includes('<svg'), `SVG has an <svg> element (${svgText.length} chars)`)
check(svgText.includes('<text'), 'SVG keeps text as <text>')
writeFileSync(join(dir, 'smoke.svg'), svgText)

const surface = ck.MakeSurface(64, 64)
drawScene(surface.getCanvas())
const image = surface.makeImageSnapshot()
for (const [name, format] of [['PNG', ck.ImageFormat.PNG], ['JPEG', ck.ImageFormat.JPEG], ['WebP', ck.ImageFormat.WEBP]]) {
  check((image.encodeToBytes(format, 90)?.length ?? 0) > 0, `encodes ${name}`)
}
image.delete()
surface.delete()

if (failures.length > 0) process.exit(1)
