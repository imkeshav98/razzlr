import release from './release.json' with { type: 'json' }

/**
 * The wasm's file name as the web app serves it, with its hash in it: a new build is a new URL, so
 * no browser or service worker cache ever pairs it with an old one or the old one with new code.
 */
export const WASM_FILE = `canvaskit-${release.files['canvaskit.wasm'].slice(0, 16)}.wasm`
