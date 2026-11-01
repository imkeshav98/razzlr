// What the editor page puts on `window` (apps/web/app/brands/[brandId]/designs/[designId]/stage.tsx), for code the checks run in the page.
import type { Editor } from '@dazbee/editor'

declare global {
  interface Window { dazbee?: Editor }
}
