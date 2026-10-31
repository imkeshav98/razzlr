import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { AccountMenu } from '../../../../../components/account-menu.tsx'
import { findDesign, getWorkspace } from '../../../../../lib/api.ts'
import { brandWords } from '../../../../../lib/i18n/index.ts'
import { getMessages } from '../../../../../lib/i18n/server.ts'
import { SESSION_COOKIE } from '../../../../../lib/sign-in.ts'
import { EditorStage } from './stage.tsx'

export const metadata = { title: 'Dazbee editor' }

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ brandId: string; designId: string }>
  searchParams: Promise<{ format?: string }>
}) {
  const { brandId, designId } = await params
  const { format } = await searchParams
  const [found, workspace, t, jar] = await Promise.all([findDesign(brandId, designId), getWorkspace(), getMessages(), cookies()])
  if (!found) notFound()
  return (
    <EditorStage
      designId={found.design.id}
      designName={found.design.name}
      brandId={found.brand.id}
      brandName={found.brand.name}
      everyBrand={brandWords(t, workspace.kind).all}
      formatId={format}
      syncUrl={process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'}
      account={<AccountMenu name={workspace.name} signedIn={jar.has(SESSION_COOKIE)} />}
    />
  )
}
