# Every export is drawn on the CPU surface

One renderer (CanvasKit, stock npm build 0.42.0) draws both in the browser and in Node. The editor screen uses the WebGL surface for speed, but every export, in the browser and on the server, uses the CPU surface, because GPU and CPU anti-alias edges differently and only CPU drawing gives identical pixels everywhere. Fonts and images are decoded by CanvasKit from bytes we control, never by the system or the browser. The export parity pass mark is 0 differing pixels: any tolerance would hide real bugs.

## Consequences

The editor screen can drift slightly from the export. The spike measures how far; if it's visible, a "preview as exported" mode draws the CPU version in a worker.
