// The editor chrome's shared looks, as class strings: every control that looks like one of these
// takes it from here instead of spelling its classes again.

/** The ring a focused control shows when reached by keyboard. */
export const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** A small pill button, as the mock's chips under a list. */
export const CHIP = 'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-line px-3 text-xs font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-line-strong hover:text-text disabled:pointer-events-none disabled:opacity-40'

/** A small square icon button in a card's row. */
export const ICON_BUTTON = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-row text-subtle transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-30'

/** A dashed button that adds something or takes an upload: Add image, Upload, a kit's Add. */
export const DASHED_BUTTON = `flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong text-xs font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-accent hover:text-text focus-within:border-accent focus-within:text-text ${FOCUS_RING}`

/** A square tile showing one image asset's thumbnail, in the asset library and the image picker. */
export const ASSET_TILE = 'grid aspect-square place-items-center overflow-hidden rounded-[10px] border border-line bg-bg/40 transition-colors duration-[var(--chrome-fast)]'

/** A popover's frosted panel, as the cards are: the shape menu, the image picker, Add format. */
export const POPOVER = 'pop-in z-50 rounded-card surface-frost'

/** A tool dock button's shape; its width is the caller's. */
export const DOCK_BUTTON = `grid h-10 cursor-pointer place-items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)] ${FOCUS_RING}`
/** The dock's colours for the tool in use, and for the others. */
export const DOCK_ON = 'bg-accent-solid text-on-accent'
export const DOCK_OFF = 'text-muted hover:bg-hover hover:text-text'
/** One tool's square dock button, lit while the tool is in use. */
export const dockTool = (on: boolean) => `${DOCK_BUTTON} w-10 ${on ? DOCK_ON : DOCK_OFF}`

/** A round colour swatch that picks its colour; its size is the caller's. */
export const SWATCH = 'shrink-0 cursor-pointer rounded-full border border-line-strong transition-transform duration-[var(--chrome-fast)] hover:scale-110'

/** The look of a value typed into a field: a number, a hex, a dash pattern. */
export const VALUE_TEXT = 'font-mono text-[12px] tabular-nums text-text'
/** A field to type a value into, as tall as a knob. */
export const FIELD = `h-8 min-w-0 w-full rounded-row border border-line bg-surface px-1.5 ${VALUE_TEXT} outline-none placeholder:text-subtle focus:border-accent`
/** A dropdown field's box, as tall as a knob. */
export const SELECT = 'h-8 w-full bg-surface px-1.5 text-[12px]'
/**
 * A number you drag sideways, as in the mock: its label at the start, its value in mono at the end,
 * and a soft fill behind them showing where the value sits in its range (`--fill`).
 */
export const KNOB = `relative flex h-8 min-w-0 cursor-ew-resize touch-pan-y select-none items-center gap-2 overflow-hidden rounded-row border border-line bg-surface px-2.5 text-[12px] font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:border-line-strong focus-within:border-accent before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:w-[var(--fill,0%)] before:bg-accent-soft before:transition-[width] before:duration-75`
/** Knobs two to a row; a lone last one takes the whole row. */
export const KNOBS = 'grid grid-cols-2 gap-1.5 [&>:last-child:nth-child(odd)]:col-span-2'

/** A small message floating at the stage's start corner: a layer removed, something auto layout decides. */
export const TOAST = 'toast-in pointer-events-auto flex h-10 items-center gap-2 rounded-card surface-frost ps-3.5 pe-1.5 text-[13px]'
