import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createDesign, listClients, listDesigns } from '../../../lib/api.ts'
import styles from '../../library.module.css'

export const dynamic = 'force-dynamic'

const updated = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const client = (await listClients()).find((c) => c.id === clientId)
  if (!client) notFound()
  const designs = await listDesigns(client.id)

  async function create(form: FormData) {
    'use server'
    const name = String(form.get('name') ?? '').trim() || 'Untitled design'
    const design = await createDesign(clientId, name)
    redirect(`/clients/${clientId}/designs/${design.id}`)
  }

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <p className={styles.crumbs}><Link href="/">Clients</Link></p>
        <h1 className={styles.title}>{client.name}</h1>
        <form className={styles.create} action={create}>
          <input name="name" aria-label="Design name" placeholder="Name a new design" maxLength={120} />
          <button type="submit">New design</button>
        </form>
        {designs.length === 0
          ? <p className={styles.empty}>No designs yet.</p>
          : (
            <ul className={styles.list} aria-label="Designs">
              {designs.map((design) => (
                <li key={design.id}>
                  <Link className={styles.item} href={`/clients/${client.id}/designs/${design.id}`}>
                    <span>{design.name}</span>
                    <span className={styles.meta}>Edited {updated.format(new Date(design.updatedAt))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </div>
    </main>
  )
}
