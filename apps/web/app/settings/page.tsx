// Settings (#109): the workspace's name. It looks like the final mock's settings: a bold title with
// the workspace beside it, and each setting in a panel.
import { CheckIcon } from '@phosphor-icons/react/ssr'
import { redirect } from 'next/navigation'
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

  async function rename(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim()
    // A name of spaces only is no name: nothing is saved, and nothing says it was.
    if (!name) redirect('/settings')
    await updateWorkspace({ name: name.slice(0, 120) })
    redirect('/settings?saved=name')
  }

  return (
    <LibraryShell t={t} words={brandWords(t)} workspace={workspace} brands={brands} showBrands={showsBrandList(brands)} place="settings">
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
      </div>
    </LibraryShell>
  )
}
