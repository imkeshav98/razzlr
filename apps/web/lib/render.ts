// Whether the browser draws in software (no GPU): headless CI and machines where Chrome falls back
// to SwiftShader. There, every frame of the home's turning aurora redraws a large blur and the
// frosted surfaces over it, so the page crawls (#144); the root's data-render says to hold it still.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i
/** Kept for the browser session only, so a browser that drew in software once probes again next time. */
const KEY = 'dazbee.render'

/** Reads the WebGL renderer's name; a browser without WebGL draws in software too. */
function probe(): 'software' | 'gpu' {
  const gl = document.createElement('canvas').getContext('webgl')
  if (!gl) return 'software'
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return SOFTWARE.test(name) ? 'software' : 'gpu'
}

/** Sets `data-render` on the root, from what this browser said before or from a new probe. */
export function markRender() {
  let render: string | null = null
  try {
    render = sessionStorage.getItem(KEY)
  } catch {
    // Storage can be blocked; probing again is cheap enough.
  }
  if (render !== 'software' && render !== 'gpu') {
    render = probe()
    try {
      sessionStorage.setItem(KEY, render)
    } catch {
      // As above.
    }
  }
  document.documentElement.dataset.render = render
}
