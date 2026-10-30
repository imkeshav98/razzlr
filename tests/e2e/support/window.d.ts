// What the editor page puts on `window` (apps/web/app/clients/[clientId]/designs/[designId]/stage.tsx), for code the checks run in the page.
import type { Editor } from '@razzlr/editor'

declare global {
  interface Window { razzlr?: Editor }
}
