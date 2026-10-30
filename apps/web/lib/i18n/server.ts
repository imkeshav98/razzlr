import 'server-only'
import { cookies } from 'next/headers'
import { CATALOGS, localeOf } from './index.ts'

export async function getLocale() {
  return localeOf((await cookies()).get('locale')?.value)
}

export async function getMessages() {
  return CATALOGS[await getLocale()]
}
