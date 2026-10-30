import { EditorStage } from './stage.tsx'

export const metadata = { title: 'Razzlr editor' }

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ format?: string }>
}) {
  const { id } = await params
  const { format } = await searchParams
  return <EditorStage designId={id} formatId={format} syncUrl={process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'} />
}
