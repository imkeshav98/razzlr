import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { TooltipProvider } from '../components/ui/tooltip.tsx'
import { fontVariables } from '../lib/fonts.ts'
import { I18nProvider } from '../lib/i18n/client.tsx'
import { dirOf } from '../lib/i18n/index.ts'
import { getLocale } from '../lib/i18n/server.ts'
import { themeOf, themeScript } from '../lib/theme.ts'
import './globals.css'

export const metadata: Metadata = { title: 'Dazbee' }
export const viewport: Viewport = { themeColor: '#0e0c11', colorScheme: 'dark light' }

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const pick = themeOf((await cookies()).get('theme')?.value)
  return (
    <html lang={locale} dir={dirOf(locale)} className={fontVariables} {...(pick === 'system' ? {} : { 'data-theme': pick })} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
