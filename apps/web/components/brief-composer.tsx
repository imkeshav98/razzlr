// The brand home's brief (#84), as in the final mock: one line asking what we are making, the
// brand's name in the AI colours, and a composer with a gradient edge holding a few words, the
// formats to make, the brand kit and Make drafts. The chips are checkboxes, so the form works before any script loads. Until
// AI drafts arrive (phase 2), Make drafts opens a blank design in the formats picked.
import { PlusIcon, SparkleIcon } from '@phosphor-icons/react/ssr'
import { FORMAT_PRESETS, SCHEMA_VERSION, type DesignInput } from '@razzlr/schema'
import { cn } from '../lib/cn.ts'
import type { Messages } from '../lib/i18n/index.ts'

/** The formats offered on the brief, the everyday ones; the editor adds any other. */
export const BRIEF_FORMATS = ['feed-square', 'feed-portrait', 'story', 'link-image'] as const

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

const CHIP = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[13px] font-semibold select-none transition-[background-color,border-color,color] duration-[var(--chrome-fast)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring'
const CHIP_OFF = 'border-line text-muted hover:border-line-strong hover:text-text'
const CHIP_ON = 'has-[:checked]:border-accent has-[:checked]:text-text'

/** The heading with the brand's name in the AI gradient: "What are we making for <brand>?". */
function Prompt({ template, brandName }: { template: string; brandName: string }) {
  const [before, after = ''] = template.split('{brand}')
  return (
    <>
      {before}
      <span className="bg-[image:var(--ai-gradient)] bg-clip-text text-transparent [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">{brandName}</span>
      {after}
    </>
  )
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
    <section aria-labelledby="brief-title" className="pt-2 pb-10 md:-mt-8 md:pt-0 md:pb-12">
      <h1 id="brief-title" className="mx-auto max-w-5xl text-center font-display text-3xl font-bold tracking-tight text-balance md:text-[2.75rem] md:leading-tight">
        <Prompt template={h.prompt} brandName={brandName} />
      </h1>
      {/* A gradient edge: the gradient behind, the composer inset by its width. */}
      <div className="mx-auto mt-6 max-w-3xl rounded-[22px] bg-[image:var(--ai-gradient)] p-[1.5px] shadow-[0_24px_60px_-28px_rgb(255_72_176/0.55)] md:mt-7">
        <form action={action} className="rounded-[20.5px] bg-surface/95 p-3 backdrop-blur md:px-5 md:py-4">
          <label htmlFor="brief" className="sr-only">{h.brief}</label>
          <textarea
            id="brief"
            name="brief"
            rows={1}
            maxLength={2000}
            placeholder={h.briefPlaceholder}
            // One line, as in the final mock, growing with what is written.
            className="block max-h-48 min-h-9 w-full resize-none bg-transparent px-1 py-1 text-base text-text [field-sizing:content] placeholder:text-subtle focus:outline-none md:text-[17px]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <fieldset className="contents">
              <legend className="sr-only">{h.formats}</legend>
              {BRIEF_FORMATS.map((id, i) => {
                const preset = FORMAT_PRESETS.find((p) => p.id === id)
                if (!preset) return null
                return (
                  <label key={id} className={cn(CHIP, CHIP_OFF, CHIP_ON)}>
                    <input type="checkbox" name="format" value={id} defaultChecked={i === 0} className="sr-only" data-testid={`brief-format-${id}`} />
                    {h.chips[id]}
                  </label>
                )
              })}
            </fieldset>
            <button type="button" disabled title={h.referenceSoon} className={cn(CHIP, CHIP_OFF, 'cursor-not-allowed opacity-70')}>
              <PlusIcon size={12} weight="bold" aria-hidden />
              {h.reference}
            </button>
            <label className={cn(CHIP, CHIP_OFF, CHIP_ON)}>
              <input type="checkbox" name="kit" value="on" defaultChecked className="sr-only" data-testid="brief-kit" />
              {kitColors.length > 0 && (
                <span aria-hidden className="flex -space-x-1">
                  {kitColors.slice(0, 4).map((color) => <span key={color} className="size-3 rounded-full ring-1 ring-surface" style={{ backgroundColor: color }} />)}
                </span>
              )}
              {h.brandKit}
            </label>
            <button
              type="submit"
              title={h.makeHint}
              className="ai-glow relative ms-auto inline-flex h-10 cursor-pointer items-center gap-2 overflow-hidden rounded-[12px] px-5 text-sm font-semibold text-white shadow-panel transition-transform duration-[var(--chrome-fast)] active:scale-[0.97]"
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
