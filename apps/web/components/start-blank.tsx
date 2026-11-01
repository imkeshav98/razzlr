// Under the brand home's brief: "Or start blank" and a row of sizes, each drawn in its own shape
// (Square, Portrait, Story, Banner), that open an empty design in that size, and a last tile for
// the brand's templates. Each size is a form, so it works before any script loads.
import { SquaresFourIcon } from '@phosphor-icons/react/ssr'
import { FORMAT_PRESETS } from '@dazbee/schema'
import Link from 'next/link'
import { BRIEF_FORMATS, type BriefFormat } from '../lib/brief.ts'
import { format, type Messages } from '../lib/i18n/index.ts'

/** The longest side of a size's outline, in pixels. */
const OUTLINE = 64

const TILE = 'group flex cursor-pointer flex-col items-center gap-2 rounded-[14px] p-1.5 sm:p-2 text-[12px] font-semibold text-muted transition-colors duration-[var(--chrome-fast)] hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const SHAPE = 'block rounded-[8px] border-[1.5px] border-line-strong bg-surface/60 shadow-panel transition-[border-color,transform,box-shadow] duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:border-accent group-hover:shadow-[0_0_0_4px_var(--accent-soft)]'

export function StartBlank({ t, brandId, start }: {
  t: Messages
  brandId: string
  /** Makes an empty design in this size and opens it. */
  start: (formatId: BriefFormat) => Promise<void>
}) {
  return (
    <section aria-labelledby="start-blank" className="rise mx-auto flex flex-col items-center gap-3" style={{ animationDelay: '120ms' }}>
      <h2 id="start-blank" className="text-[13px] font-medium text-subtle">{t.home.startBlank}</h2>
      <ul className="flex flex-wrap items-end justify-center gap-1 sm:gap-3 md:gap-5">
        {BRIEF_FORMATS.map((id) => {
          const preset = FORMAT_PRESETS.find((p) => p.id === id)
          if (!preset) return null
          const scale = OUTLINE / Math.max(preset.width, preset.height)
          const name = t.home.chips[id]
          return (
            <li key={id}>
              <form action={start.bind(null, id)}>
                <button type="submit" aria-label={format(t.home.startIn, { name })} className={TILE} data-testid={`start-blank-${id}`}>
                  <span aria-hidden className={SHAPE} style={{ width: Math.round(preset.width * scale), height: Math.round(preset.height * scale) }} />
                  {name}
                </button>
              </form>
            </li>
          )
        })}
        <li>
          <Link href={`/brands/${brandId}/templates`} className={TILE} data-testid="start-template">
            <span aria-hidden className={`${SHAPE} grid place-items-center border-dashed text-subtle`} style={{ width: OUTLINE, height: OUTLINE }}>
              <SquaresFourIcon size={20} />
            </span>
            {t.home.fromTemplate}
          </Link>
        </li>
      </ul>
    </section>
  )
}
