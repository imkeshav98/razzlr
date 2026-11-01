// Settings (#109): the workspace's name, and who Dazbee is for, the same three cards onboarding asks
// with. Changing who it is for changes only words and defaults (ADR-0011): an agency calls its
// brands clients. It looks like the
// final mock's settings: a bold title with the workspace beside it, and each setting in a panel.
import { CheckIcon } from '@phosphor-icons/react/ssr'
import { WorkspaceKind } from '@razzlr/schema'
import { redirect } from 'next/navigation'
import { KindCards } from '../../components/kind-cards.tsx'
import { LibraryShell } from '../../components/library-shell.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { getWorkspace, listBrands, updateWorkspace } from '../../lib/api.ts'
import { showsBrandList } from '../../lib/home.ts'
import { brandWords } from '../../lib/i18n/index.ts'
import { getMessages } from '../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

/** A short note that a section's change was saved. */
function Saved({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
      <CheckIcon size={16} weight="bold" aria-hidden className="text-success" />
      {label}
    </span>
  )
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])

  async function save(form: FormData) {
    'use server'
    const kind = WorkspaceKind.safeParse(form.get('kind'))
    if (kind.success) await updateWorkspace({ kind: kind.data })
    redirect('/settings?saved=kind')
  }

  async function rename(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim()
    if (name) await updateWorkspace({ name: name.slice(0, 120) })
    redirect('/settings?saved=name')
  }

  return (
    <LibraryShell t={t} words={brandWords(t, workspace.kind)} workspace={workspace.name} brands={brands} showBrands={showsBrandList(workspace.kind, brands)} place="settings">
      <div className="mx-auto max-w-5xl pt-2 md:pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-[2.5rem] md:leading-tight">{t.settings.title}</h1>
          <span className="text-sm font-medium text-muted">{workspace.name}</span>
        </div>
        <section aria-labelledby="workspace-title" className="mt-6 rounded-[20px] border border-line bg-surface p-5 shadow-panel md:mt-8 md:p-7">
          <h2 id="workspace-title" className="font-display text-2xl font-bold tracking-tight md:text-[2rem] md:leading-tight">{t.settings.workspace}</h2>
          <form action={rename} className="mt-5 flex flex-col gap-2">
            <label htmlFor="workspace-name" className="text-sm font-medium">{t.settings.workspaceName}</label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="workspace-name"
                name="name"
                required
                maxLength={120}
                defaultValue={workspace.name}
                autoComplete="organization"
                className="h-11 min-w-0 flex-1 basis-64 rounded-row border border-line bg-bg px-3 text-[15px] outline-none hover:border-line-strong focus:border-accent"
              />
              <button type="submit" className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}>{t.settings.save}</button>
              {saved === 'name' && <Saved label={t.settings.saved} />}
            </div>
          </form>
        </section>
        <section aria-labelledby="kind-title" className="mt-4 rounded-[20px] border border-line bg-surface p-5 shadow-panel md:mt-5 md:p-7">
          <h2 id="kind-title" className="font-display text-2xl font-bold tracking-tight md:text-[2rem] md:leading-tight">{t.settings.kind}</h2>
          <p className="mt-2 text-sm text-muted">{t.settings.kindLead}</p>
          <div className="mt-6">
            <KindCards t={t} current={workspace.kind} action={save} legend={t.settings.kind}>
              <div className="mt-6 flex items-center gap-4 border-t border-line pt-5">
                <button type="submit" className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}>{t.settings.save}</button>
                {saved === 'kind' && <Saved label={t.settings.saved} />}
              </div>
            </KindCards>
          </div>
        </section>
      </div>
    </LibraryShell>
  )
}
