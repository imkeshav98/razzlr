// Settings (#109): who Razzlr is for, the same three cards onboarding asks with. Changing it
// changes only words and defaults (ADR-0011): an agency calls its brands clients.
import { CheckIcon } from '@phosphor-icons/react/ssr'
import { WorkspaceKind } from '@razzlr/schema'
import { redirect } from 'next/navigation'
import { KindCards } from '../../components/kind-cards.tsx'
import { LibraryShell } from '../../components/library-shell.tsx'
import { buttonStyles } from '../../components/ui/button.tsx'
import { getWorkspace, listBrands, setWorkspaceKind } from '../../lib/api.ts'
import { showsBrandList } from '../../lib/home.ts'
import { brandWords } from '../../lib/i18n/index.ts'
import { getMessages } from '../../lib/i18n/server.ts'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams
  const [t, workspace, brands] = await Promise.all([getMessages(), getWorkspace(), listBrands()])

  async function save(form: FormData) {
    'use server'
    const kind = WorkspaceKind.safeParse(form.get('kind'))
    if (kind.success) await setWorkspaceKind(kind.data)
    redirect('/settings?saved=1')
  }

  return (
    <LibraryShell t={t} words={brandWords(t, workspace.kind)} brands={brands} showBrands={showsBrandList(workspace.kind, brands)} place="settings">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t.settings.title}</h1>
      <section aria-labelledby="kind-title" className="mt-8">
        <h2 id="kind-title" className="font-display text-lg font-semibold tracking-tight">{t.settings.kind}</h2>
        <p className="mt-1 text-sm text-muted">{t.welcome.lead}</p>
        <div className="mt-4">
          <KindCards t={t} current={workspace.kind} action={save} legend={t.settings.kind}>
            <div className="mt-4 flex items-center gap-3">
              <button type="submit" className={buttonStyles({ variant: 'primary', size: 'lg' })}>{t.settings.save}</button>
              {saved && (
                <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <CheckIcon size={16} weight="bold" aria-hidden className="text-success" />
                  {t.settings.saved}
                </span>
              )}
            </div>
          </KindCards>
        </div>
      </section>
    </LibraryShell>
  )
}
