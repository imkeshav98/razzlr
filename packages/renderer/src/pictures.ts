import type { Canvas, CanvasKit, SkPicture as Picture } from 'canvaskit-wasm'
import type { Resources } from './draw.ts'
import type { SceneLayer } from './scene.ts'

/** Wide enough for any layer on any page: playback never clips to it, the page clip does. */
const ANYWHERE = 1e6

/**
 * Each top-level layer recorded once and kept, for the editor's screen (#36): recording a frame
 * again replays the layers that didn't change, so typing in one layer costs one layer, not the
 * page. A layer is known by its object, which `render` with a `SceneMemo` keeps while nothing it
 * draws changes; the whole cache goes when the fonts or images it was drawn with do. The oldest
 * pictures go past `limit`.
 */
export function layerPictures(limit = 4000) {
  const entries = new Map<SceneLayer, Picture>()
  let drawnWith: Pick<Resources, 'fonts' | 'images' | 'fallbackFamilies'> | null = null
  const clear = () => {
    for (const picture of entries.values()) picture.delete()
    entries.clear()
  }
  return {
    picture(ck: CanvasKit, layer: SceneLayer, resources: Resources, draw: (canvas: Canvas) => void): Picture {
      if (drawnWith?.fonts !== resources.fonts || drawnWith.images !== resources.images || drawnWith.fallbackFamilies !== resources.fallbackFamilies) {
        clear()
        drawnWith = resources
      }
      const hit = entries.get(layer)
      if (hit) {
        entries.delete(layer)
        entries.set(layer, hit)
        return hit
      }
      const recorder = new ck.PictureRecorder()
      let picture: Picture
      try {
        draw(recorder.beginRecording(ck.XYWHRect(-ANYWHERE, -ANYWHERE, 2 * ANYWHERE, 2 * ANYWHERE)))
        picture = recorder.finishRecordingAsPicture()
      } finally {
        recorder.delete()
      }
      entries.set(layer, picture)
      for (const [oldest, old] of entries) {
        if (entries.size <= limit) break
        entries.delete(oldest)
        old.delete()
      }
      return picture
    },
    delete: clear,
  }
}
export type LayerPictures = ReturnType<typeof layerPictures>
