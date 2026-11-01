// The brand home's brief (#84), as in the final mock: one line asking what we are making, the
// brand's name in the AI colours, and a composer with a gradient edge around the brief's form
// (#136). Until AI drafts arrive (phase 2), Make drafts opens a blank design in the formats picked.
import type { BrandKit } from '@dazbee/schema'
import type { Messages } from '../lib/i18n/index.ts'
import { BriefForm, type BriefReference } from './brief-form.tsx'

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

export function BriefComposer({ t, brandId, brandName, kit, references, action }: {
  t: Messages
  brandId: string
  brandName: string
  /** The brand's whole kit, to pick from in the Brand kit popover. */
  kit: BrandKit
  /** The brand's designs a brief can start from as its reference ad, newest first. */
  references: BriefReference[]
  action: (form: FormData) => Promise<void>
}) {
  return (
    <section aria-labelledby="brief-title" className="pt-2 pb-10 md:-mt-8 md:pt-0 md:pb-12">
      <h1 id="brief-title" className="mx-auto max-w-5xl text-center font-display text-3xl font-bold tracking-tight text-balance md:text-[2.75rem] md:leading-tight">
        <Prompt template={t.home.prompt} brandName={brandName} />
      </h1>
      {/* A gradient edge: the gradient behind, the composer inset by its width. */}
      <div className="ai-edge relative mx-auto mt-6 max-w-3xl rounded-[22px] p-[1.5px] shadow-[0_24px_60px_-28px_rgb(255_72_176/0.55)] md:mt-7">
        <BriefForm brandId={brandId} brandName={brandName} kit={kit} references={references} action={action} />
      </div>
    </section>
  )
}
