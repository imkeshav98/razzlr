import Link from 'next/link'
import { listClients } from '../lib/api.ts'
import styles from './library.module.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const clients = await listClients()
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <p className={styles.crumbs}>Razzlr</p>
        <h1 className={styles.title}>Clients</h1>
        {clients.length === 0
          ? <p className={styles.empty}>No clients yet.</p>
          : (
            <ul className={styles.list}>
              {clients.map((client) => (
                <li key={client.id}>
                  <Link className={styles.item} href={`/clients/${client.id}`}>{client.name}</Link>
                </li>
              ))}
            </ul>
          )}
      </div>
    </main>
  )
}
