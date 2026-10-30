// Every keyboard shortcut of the stage in one table (#40): the editor reads it to act on keys, the
// tests to press them, and the help overlay will list it. A key is `Mod` (Ctrl, or ⌘ on a Mac),
// `Shift` and `Alt`, then one key: a letter, matched by the character it types, or a
// KeyboardEvent.code for anything else, so brackets and digits work whatever Shift does to them.

export const SHORTCUTS = [
  { action: 'undo', keys: ['Mod+Z'] },
  { action: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'] },
  { action: 'selectAll', keys: ['Mod+A'] },
  { action: 'deselect', keys: ['Escape'] },
  { action: 'delete', keys: ['Delete', 'Backspace'] },
  { action: 'duplicate', keys: ['Mod+D'] },
  { action: 'group', keys: ['Mod+G'] },
  { action: 'ungroup', keys: ['Mod+Shift+G'] },
  { action: 'bringForward', keys: ['Mod+BracketRight'] },
  { action: 'sendBackward', keys: ['Mod+BracketLeft'] },
  { action: 'bringToFront', keys: ['Mod+Shift+BracketRight'] },
  { action: 'sendToBack', keys: ['Mod+Shift+BracketLeft'] },
  { action: 'alignLeft', keys: ['Alt+A'] },
  { action: 'alignCentre', keys: ['Alt+H'] },
  { action: 'alignRight', keys: ['Alt+D'] },
  { action: 'alignTop', keys: ['Alt+W'] },
  { action: 'alignMiddle', keys: ['Alt+V'] },
  { action: 'alignBottom', keys: ['Alt+S'] },
  { action: 'distributeHorizontal', keys: ['Alt+Shift+H'] },
  { action: 'distributeVertical', keys: ['Alt+Shift+V'] },
  { action: 'lock', keys: ['Mod+Shift+L'] },
  { action: 'hide', keys: ['Mod+Shift+H'] },
  { action: 'nudgeLeft', keys: ['ArrowLeft'] },
  { action: 'nudgeRight', keys: ['ArrowRight'] },
  { action: 'nudgeUp', keys: ['ArrowUp'] },
  { action: 'nudgeDown', keys: ['ArrowDown'] },
  { action: 'nudgeLeftFar', keys: ['Shift+ArrowLeft'] },
  { action: 'nudgeRightFar', keys: ['Shift+ArrowRight'] },
  { action: 'nudgeUpFar', keys: ['Shift+ArrowUp'] },
  { action: 'nudgeDownFar', keys: ['Shift+ArrowDown'] },
  { action: 'zoomToFit', keys: ['Shift+Digit1'] },
  { action: 'zoomToSelection', keys: ['Shift+Digit2'] },
  { action: 'zoomTo100', keys: ['Shift+Digit0', 'Mod+Digit0'] },
  { action: 'zoomIn', keys: ['Mod+Equal', 'Mod+Shift+Equal', 'Mod+NumpadAdd'] },
  { action: 'zoomOut', keys: ['Mod+Minus', 'Mod+NumpadSubtract'] },
  { action: 'toggleRulers', keys: ['Shift+R'] },
  { action: 'toolSelect', keys: ['V'] },
  { action: 'toolHand', keys: ['H'] },
  { action: 'toolRect', keys: ['R'] },
  { action: 'toolEllipse', keys: ['O'] },
  { action: 'toolLine', keys: ['L'] },
  { action: 'toolArrow', keys: ['Shift+L'] },
  { action: 'toolPen', keys: ['P'] },
  { action: 'toolText', keys: ['T'] },
  { action: 'editPoints', keys: ['Enter'] },
  { action: 'autoLayout', keys: ['Shift+A'] },
  { action: 'booleanUnion', keys: ['Mod+Alt+U'] },
  { action: 'booleanSubtract', keys: ['Mod+Alt+S'] },
  { action: 'booleanIntersect', keys: ['Mod+Alt+I'] },
  { action: 'booleanExclude', keys: ['Mod+Alt+X'] },
] as const satisfies readonly { action: string; keys: readonly string[] }[]

export type ShortcutAction = (typeof SHORTCUTS)[number]['action']

/** How far the arrow keys move the selection, in design pixels: 1, or 10 with Shift. */
export const NUDGE = 1
export const NUDGE_FAR = 10

interface Parsed { mod: boolean; shift: boolean; alt: boolean; key: string }
const parse = (spec: string): Parsed => {
  const parts = spec.split('+')
  const key = parts.at(-1) ?? ''
  return { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key }
}
const isLetter = (key: string) => /^[A-Z]$/.test(key)

const byAction = SHORTCUTS.flatMap(({ action, keys }) => keys.map((spec) => ({ action, ...parse(spec) })))

/** The action a key press asks for, if any. */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey
  for (const s of byAction) {
    if (s.mod !== mod || s.shift !== e.shiftKey || s.alt !== e.altKey) continue
    // With Alt a Mac types another character (⌥A is å), so there the key's place decides.
    const letter = isLetter(s.key) && (e.key.toUpperCase() === s.key || (e.altKey && e.code === `Key${s.key}`))
    if (isLetter(s.key) ? letter : e.code === s.key) return s.action
  }
  return null
}

/** The first key of an action, as Playwright's keyboard.press spells it, for tests. */
export function pressFor(action: ShortcutAction, mod: 'Control' | 'Meta' = 'Control') {
  const spec = SHORTCUTS.find((s) => s.action === action)?.keys[0] ?? ''
  return spec.split('+').map((part) => (part === 'Mod' ? mod : isLetter(part) ? `Key${part}` : part)).join('+')
}
