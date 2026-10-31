// Message catalogs and the person's locale. The locale comes from the `locale` cookie; Arabic
// turns the whole UI right to left (CSS is written with logical properties only).
import type { WorkspaceKind } from '@razzlr/schema'
import { ar } from './ar.ts'
import { en, type Messages } from './en.ts'

export type { Messages }

export const CATALOGS = { en, ar } satisfies Record<string, Messages>
export type Locale = keyof typeof CATALOGS
export const LOCALES = Object.keys(CATALOGS) as Locale[]
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية' }

export const localeOf = (value: string | undefined): Locale => (value && value in CATALOGS ? value as Locale : 'en')
export const dirOf = (locale: Locale): 'ltr' | 'rtl' => (locale === 'ar' ? 'rtl' : 'ltr')

/** How a workspace names its brands: an agency's are its clients (ADR-0011). */
export function brandWords(t: Messages, kind: WorkspaceKind) {
  const l = t.library
  return kind === 'agency'
    ? { title: l.clients, lead: l.clientsLead, none: l.noClients, all: l.allClients }
    : { title: l.brands, lead: l.brandsLead, none: l.noBrands, all: l.allBrands }
}
export type BrandWords = ReturnType<typeof brandWords>

/** Fills `{name}` placeholders in a catalog string. */
export const format = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
