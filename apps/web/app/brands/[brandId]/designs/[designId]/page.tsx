import { notFound } from 'next/navigation'
import { findDesign } from '../../../../../lib/api.ts'
import { EditorStage } from './stage.tsx'

export const metadata = { title: 'Razzlr editor' }

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ brandId: string; designId: string }>
  searchParams: Promise<{ format?: string }>
}) {
  const { brandId, designId } = await params
  const { format } = await searchParams
  const found = await findDesign(brandId, designId)
  if (!found) notFound()
  return (
    <EditorStage
      designId={found.design.id}
      designName={found.design.name}
      brandId={found.brand.id}
      brandName={found.brand.name}
      formatId={format}
      syncUrl={process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'}
    />
  )
}
