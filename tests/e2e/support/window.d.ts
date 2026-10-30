// What the editor page puts on `window` (apps/web/app/edit/[id]/stage.tsx), for code the checks run in the page.
import type { Editor } from '@razzlr/web/editor'

declare global {
  interface Window { razzlr?: Editor }
}
