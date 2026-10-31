// The brand home's brief (#84): a few words, the formats to make, the brand kit, and Make drafts,
// under a slow aurora. The chips are checkboxes, so the form works before any script loads. Until
// AI drafts arrive (phase 2), Make drafts opens a blank design in the formats picked.
import { ImageSquareIcon, PaletteIcon, SparkleIcon } from '@phosphor-icons/react/ssr'
import { FORMAT_PRESETS, SCHEMA_VERSION, type DesignInput } from '@razzlr/schema'
import { cn } from '../lib/cn.ts'
import { format, type Messages } from '../lib/i18n/index.ts'

/** The formats offered on the brief, the everyday ones; the editor adds any other. */
export const BRIEF_FORMATS = ['feed-square', 'feed-portrait', 'story', 'link-image', 'video-hd'] as const

/** A blank design in the formats a brief picked, the first one primary. */
export function briefDesign(name: string, formatIds: string[], formatName: (id: string) => string): DesignInput {
  const picked = FORMAT_PRESETS.filter((p) => formatIds.includes(p.id))
  const presets = picked.length > 0 ? picked : FORMAT_PRESETS.filter((p) => p.id === BRIEF_FORMATS[0])
  return {
    meta: { schemaVersion: SCHEMA_VERSION, designId: 'replaced-by-the-api', name, kind: 'single', primaryFormatId: 'f1' },
    formats: Object.fromEntries(presets.map((p, i) => [`f${i + 1}`, { name: formatName(p.id), width: p.width, height: p.height, order: `a${i}` }])),
    pages: { p1: { name: 'Page 1', order: 'a0', fills: [{ type: 'solid', color: '#FFFFFFFF' }] } },
    nodes: {},
    overrides: {},
  }
}

const CHIP = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium select-none transition-[background-color,border-color,color] duration-[var(--chrome-fast)]'
const CHIP_OFF = 'border-line bg-raised/70 text-muted hover:border-line-strong hover:text-text'
const CHIP_ON = 'has-[:checked]:border-transparent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text'

/** A tiny outline of a format's shape, so chips read at a glance. */
function Shape({ width, height }: { width: number; height: number }) {
  const scale = 12 / Math.max(width, height)
  return <span aria-hidden className="inline-block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(5, width * scale), height: Math.max(5, height * scale) }} />
}

export function BriefComposer({ t, brandName, kitColors, action }: {
  t: Messages
  brandName: string
  /** The brand kit's colours, shown on its chip; none when the kit has no colours yet. */
  kitColors: string[]
  action: (form: FormData) => Promise<void>
}) {
  const h = t.home
  return (
    <section aria-labelledby="brief-title" className="relative isolate">
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden rounded-[28px]">
        <div className="aurora" />
      </div>
      <div className="mx-auto max-w-3xl px-1 pt-6 pb-8 md:pt-12 md:pb-12">
        <h1 id="brief-title" className="text-center font-display text-3xl font-semibold tracking-tight text-balance md:text-5xl">
          {format(h.prompt, { brand: brandName })}
        </h1>
        <form action={action} className="mt-6 rounded-[22px] surface-frost border p-3 shadow-panel md:mt-8 md:p-4">
          <label htmlFor="brief" className="sr-only">{h.brief}</label>
          <textarea
            id="brief"
            name="brief"
            rows={3}
            maxLength={2000}
            placeholder={h.briefPlaceholder}
            className="block w-full resize-none bg-transparent px-2 py-1.5 text-base text-text placeholder:text-subtle focus:outline-none md:text-lg"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <fieldset className="contents">
              <legend className="sr-only">{h.formats}</legend>
              {BRIEF_FORMATS.map((id, i) => {
                const preset = FORMAT_PRESETS.find((p) => p.id === id)
                if (!preset) return null
                return (
                  <label key={id} className={cn(CHIP, CHIP_OFF, CHIP_ON, 'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring')}>
                    <input type="checkbox" name="format" value={id} defaultChecked={i === 0} className="sr-only" data-testid={`brief-format-${id}`} />
                    <Shape width={preset.width} height={preset.height} />
                    {t.editor.formats.preset[id]}
                  </label>
                )
              })}
            </fieldset>
            <span aria-hidden className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <label className={cn(CHIP, CHIP_OFF, CHIP_ON, 'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring')}>
              <input type="checkbox" name="kit" value="on" defaultChecked className="sr-only" data-testid="brief-kit" />
              {kitColors.length > 0
                ? (
                  <span aria-hidden className="flex -space-x-1">
                    {kitColors.slice(0, 4).map((color) => <span key={color} className="size-3 rounded-full ring-1 ring-bg" style={{ backgroundColor: color }} />)}
                  </span>
                )
                : <PaletteIcon size={14} aria-hidden />}
              {h.brandKit}
            </label>
            <button type="button" disabled title={h.referenceSoon} className={cn(CHIP, CHIP_OFF, 'cursor-not-allowed opacity-60')}>
              <ImageSquareIcon size={14} aria-hidden />
              {h.reference}
            </button>
            <button
              type="submit"
              title={h.makeHint}
              className="ai-glow ms-auto inline-flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-full px-5 text-sm font-semibold text-white shadow-panel transition-transform duration-[var(--chrome-fast)] active:scale-[0.97]"
            >
              <SparkleIcon size={16} weight="fill" aria-hidden />
              {h.make}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
