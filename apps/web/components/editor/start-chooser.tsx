'use client'

// The new design screen (the final mock's "How do you want to start?"): over the empty canvas of a
// design just made from the brief, three ways in, Describe it (AI drafts, soon), a Template or the
// Blank sizes the brief picked, and a row of the brand's latest templates. Starting from a template
// turns the design into a copy of it. Skip, Esc, a tool from the dock or drawing anything closes it.
import { ArrowLeftIcon, CircleNotchIcon, FrameCornersIcon, SparkleIcon, SquaresFourIcon, XIcon } from '@phosphor-icons/react'
import type { Editor } from '@dazbee/editor'
import { useEffect, useState, useTransition } from 'react'
import { cn } from '../../lib/cn.ts'
import { useMessages } from '../../lib/i18n/client.tsx'
import { format } from '../../lib/i18n/index.ts'
import { useLiveDesign } from './use-live-design.ts'

/** A template to start from, with its primary format's size for its picture. */
export type StartTemplate = { id: string; name: string; width: number; height: number }

/** How many templates the row under the three ways shows. */
const RECENT = 5

const WAY = 'flex flex-col sm:min-h-40 items-start gap-2 rounded-[20px] border surface-frost p-5 text-start shadow-panel transition-[border-color,transform] duration-[var(--chrome)] ease-[var(--ease-out)]'

export function StartChooser({ editor, brandId, templates, onClose, onTemplate }: {
  editor: Editor
  brandId: string
  /** The brand's templates and the workspace's, newest first. */
  templates: StartTemplate[]
  onClose: () => void
  /** Turns this design into a copy of the template; the page moves to it. */
  onTemplate: (templateId: string) => Promise<void>
}) {
  const t = useMessages().editor.start
  const { design } = useLiveDesign(editor)
  const [view, setView] = useState<'ways' | 'templates'>('ways')
  const [picked, setPicked] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const drawn = Object.keys(design.nodes).length > 0

  // Anything drawn on the canvas means a start was made.
  useEffect(() => {
    if (drawn && !pending) onClose()
  }, [drawn, pending, onClose])

  // Picking a tool from the dock is starting blank.
  useEffect(() => {
    const stop = editor.onTool(() => onClose())
    return () => {
      stop()
    }
  }, [editor, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (view === 'templates') setView('ways')
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, onClose])

  const use = (id: string) => {
    setPicked(id)
    startTransition(() => onTemplate(id))
  }
  const picture = (template: StartTemplate) => `/brands/${encodeURIComponent(brandId)}/templates/${encodeURIComponent(template.id)}/thumbnail`
  const tile = (template: StartTemplate, big: boolean) => (
    <button
      key={template.id}
      type="button"
      onClick={() => use(template.id)}
      disabled={pending}
      aria-label={format(t.use, { name: template.name })}
      title={template.name}
      className={cn(
        'group relative shrink-0 cursor-pointer overflow-hidden rounded-[12px] border border-line bg-raised shadow-panel transition-transform duration-[var(--chrome-fast)] hover:-translate-y-0.5 disabled:cursor-default',
        big ? 'aspect-square w-full' : 'size-24 md:size-28',
      )}
    >
      <img src={picture(template)} alt="" width={template.width} height={template.height} loading="lazy" className="size-full object-cover" />
      {big && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-2 text-start text-[12px] font-medium text-white">{template.name}</span>}
      {picked === template.id && (
        <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
          <CircleNotchIcon size={22} aria-hidden className="animate-spin" />
        </span>
      )}
    </button>
  )

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="start-title"
      data-testid="start-chooser"
      className="absolute inset-0 z-[9] grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_74%,transparent)] px-4 pt-36 pb-44 backdrop-blur-[6px] sm:pt-24 sm:pb-28 md:ps-28 md:pe-80"
    >
      <div className="relative flex w-full max-w-3xl flex-col items-center gap-6">
        <div className="flex w-full flex-col items-center gap-2">
          <div className="flex w-full items-center">
          {view === 'templates' && (
            <button type="button" onClick={() => setView('ways')} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hover:bg-hover hover:text-text">
              <ArrowLeftIcon size={15} aria-hidden className="rtl:-scale-x-100" />
              {t.back}
            </button>
          )}
          <button type="button" onClick={onClose} className="ms-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hover:bg-hover hover:text-text" data-testid="start-skip">
            {t.skip}
            <XIcon size={13} weight="bold" aria-hidden />
          </button>
          </div>
          <h2 id="start-title" className="text-center font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl md:text-[2.5rem] md:leading-tight">
            {view === 'ways' ? t.title : t.templatesTitle}
          </h2>
        </div>

        {view === 'ways'
          ? (
            <>
              <div className="grid w-full gap-3 sm:grid-cols-3">
                <div aria-disabled="true" className={cn(WAY, 'rise relative opacity-60')}>
                  <span className="absolute end-4 top-4 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">{t.soon}</span>
                  <span aria-hidden className="grid size-10 place-items-center rounded-[12px] bg-[image:var(--ai-gradient)] text-white"><SparkleIcon size={18} weight="fill" /></span>
                  <span className="font-display text-xl font-bold">{t.describe}</span>
                  <span className="text-sm text-muted text-pretty">{t.describeBody}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setView('templates')}
                  disabled={templates.length === 0}
                  className={cn(WAY, 'rise cursor-pointer border-line hover:-translate-y-0.5 hover:border-accent disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-line')}
                  style={{ animationDelay: '50ms' }}
                  data-testid="start-template"
                >
                  <span aria-hidden className="grid size-10 place-items-center rounded-[12px] border border-line text-muted"><SquaresFourIcon size={18} /></span>
                  <span className="font-display text-xl font-bold">{t.template}</span>
                  <span className="text-sm text-muted text-pretty">{templates.length === 0 ? t.noTemplates : t.templateBody}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(WAY, 'rise cursor-pointer border-line hover:-translate-y-0.5 hover:border-accent')}
                  style={{ animationDelay: '100ms' }}
                  data-testid="start-blank"
                >
                  <span aria-hidden className="grid size-10 place-items-center rounded-[12px] border border-line text-muted"><FrameCornersIcon size={18} /></span>
                  <span className="font-display text-xl font-bold">{t.blank}</span>
                  <span className="text-sm text-muted text-pretty">{t.blankBody}</span>
                </button>
              </div>
              {templates.length > 0 && (
                <div className="rise flex w-full flex-col items-center gap-3" style={{ animationDelay: '150ms' }}>
                  <p className="text-[13px] font-medium text-muted">{t.recent}</p>
                  <div className="flex max-w-full gap-3 overflow-x-auto p-1">{templates.slice(0, RECENT).map((template) => tile(template, false))}</div>
                </div>
              )}
            </>
          )
          : (
            <ul aria-label={t.templatesTitle} className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {templates.map((template, i) => (
                <li key={template.id} className="rise min-w-0" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>{tile(template, true)}</li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}
