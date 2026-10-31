'use client'

// Save as template (#54): the design as the editor holds it now, named, for every brand of the
// workspace or this brand alone. The template keeps its own copy; editing this design later
// leaves it as it was.
import type { Editor } from '@razzlr/editor'
import { ApiError, TemplateSummary, type TemplateScope } from '@razzlr/schema'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { Button } from '../ui/button.tsx'

const LABEL = 'text-xs font-semibold tracking-wide text-muted'
const CHOICE = 'flex min-h-8 cursor-pointer items-center gap-2 rounded-row px-2 text-[13px] hover:bg-hover'

/** The Save as template form (#54), opened from the Share menu. */
export function TemplateForm({ id, editor, brandId, brandName, designName, everyBrand }: {
  id: string
  editor: Editor
  brandId: string
  brandName: string
  designName: string
  everyBrand: string
}) {
  const t = useMessages()
  const [name, setName] = useState(designName)
  const [scope, setScope] = useState<TemplateScope>('brand')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<TemplateSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const response = await fetch(`/brands/${encodeURIComponent(brandId)}/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scope, content: editor.design() }),
      })
      const json: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(ApiError.safeParse(json).data?.error ?? String(response.status))
      setSaved(TemplateSummary.parse(json))
    } catch (reason) {
      setError(format(t.editor.templates.failed, { reason: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      id={id}
      role="dialog"
      aria-label={t.editor.templates.title}
      data-testid="template"
      className="modal-in absolute end-0 top-full z-30 mt-2 flex w-72 flex-col gap-3 rounded-card border surface-frost p-3 shadow-panel"
    >
      {saved
        ? (
          <>
            <p role="status" className="text-[13px]">{format(t.editor.templates.saved, { name: saved.name })}</p>
            <Link href={`/brands/${encodeURIComponent(brandId)}?show=templates`} className="text-[13px] font-medium text-accent-text hover:underline">
              {t.editor.templates.see}
            </Link>
          </>
        )
        : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{t.editor.templates.name}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                className="h-8 rounded-row border border-line bg-raised px-2 text-[13px] focus:border-accent focus:outline-none"
              />
            </label>
            <fieldset className="flex flex-col">
              <legend className={cn(LABEL, 'mb-1.5')}>{t.editor.templates.for}</legend>
              <label className={CHOICE}>
                <input type="radio" name="scope" checked={scope === 'brand'} onChange={() => setScope('brand')} />
                {format(t.editor.templates.onlyBrand, { brand: brandName })}
              </label>
              <label className={CHOICE}>
                <input type="radio" name="scope" checked={scope === 'workspace'} onChange={() => setScope('workspace')} />
                {everyBrand}
              </label>
            </fieldset>
            <Button type="submit" variant="primary" disabled={saving || !name.trim()} data-testid="template-save">
              {saving ? t.editor.templates.saving : t.editor.templates.save}
            </Button>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          </form>
        )}
    </div>
  )
}
