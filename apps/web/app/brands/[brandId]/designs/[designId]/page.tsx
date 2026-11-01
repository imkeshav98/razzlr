import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { AccountMenu } from '../../../../../components/account-menu.tsx'
import { findDesign, getWorkspace, listTemplates } from '../../../../../lib/api.ts'
import { brandWords } from '../../../../../lib/i18n/index.ts'
import { getMessages } from '../../../../../lib/i18n/server.ts'
import { SESSION_COOKIE } from '../../../../../lib/sign-in.ts'
import { EditorStage } from './stage.tsx'

export const metadata = { title: 'Dazbee editor' }

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ brandId: string; designId: string }>
  searchParams: Promise<{ format?: string; start?: string }>
}) {
  const { brandId, designId } = await params
  const { format, start } = await searchParams
  // ?start=1: a design just made from the brief, which opens on the new design screen.
  const starting = start === '1'
  const [found, workspace, t, jar, templates] = await Promise.all([
    findDesign(brandId, designId), getWorkspace(), getMessages(), cookies(), starting ? listTemplates(brandId) : Promise.resolve([]),
  ])
  if (!found) notFound()
  return (
    <EditorStage
      designId={found.design.id}
      designName={found.design.name}
      brandId={found.brand.id}
      brandName={found.brand.name}
      everyBrand={brandWords(t).all}
      formatId={format}
      start={starting ? templates.map(({ id, name, width, height }) => ({ id, name, width, height })) : null}
      syncUrl={process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'}
      account={<AccountMenu name={workspace.name} signedIn={jar.has(SESSION_COOKIE)} />}
    />
  )
}
