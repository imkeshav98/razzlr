# Every export is drawn on the CPU surface

One renderer (CanvasKit, our own build in `packages/canvaskit`) draws both in the browser and in Node. The editor screen uses the WebGL surface for speed, but every export, in the browser and on the server, uses the CPU surface, because GPU and CPU anti-alias edges differently and only CPU drawing gives identical pixels everywhere. Fonts and images are decoded by CanvasKit from bytes we control, never by the system or the browser. The export parity pass mark is 0 differing pixels: any tolerance would hide real bugs.

## Consequences

Every runtime loads the same build, because two builds could draw differently. It is npm's `canvaskit-wasm` 0.42.0 `full` build (JPEG and WebP encode, paragraph and HarfBuzz) made from the same Skia commit, `66108990f8f6edbfe9650d7023b5cf1154d71910`, plus Skia's PDF and SVG backends, which npm's builds leave out. `build/vector_bindings.cpp` hands out a CanvasKit `Canvas` for each PDF page and SVG document, so PDF and SVG exports run the same drawing code as the pixels. The wasm is 9.5 MB (3.74 MB gzipped) against 8.2 MB (3.29 MB) for npm's full build.

The build runs in CI (`.github/workflows/canvaskit.yml`, about 15 minutes) and is published as the GitHub release `canvaskit-<recipe hash>`, where the hash covers everything in `packages/canvaskit/build`. `packages/canvaskit/release.json` names that release and each file's SHA-256, and `pnpm install` fetches and checks the files, so no install or normal CI run rebuilds. To update the build, for example to a newer Skia, change `build/` (the Skia commit is in `build/skia-commit`), let the workflow build it on the pull request, commit the `release.json` it prints, then re-measure the drift baselines. Its types are npm's 0.42.0 types, copied into `types/canvaskit.d.ts`, plus the PDF and SVG documents in `types/index.d.ts`; a newer Skia means copying the matching types.

The editor screen can drift slightly from the export. The spike measures how far; if it's visible, a "preview as exported" mode draws the CPU version in a worker.
