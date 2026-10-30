// The UI's typefaces, served from our own files (#51): Figtree for text, Bricolage Grotesque for
// headings and AI moments, JetBrains Mono for numbers, Noto Naskh Arabic and Noto Sans Devanagari
// for those scripts.
import localFont from 'next/font/local'

export const figtree = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2', weight: '300 900' },
    { path: '../node_modules/@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2', weight: '300 900' },
  ],
  variable: '--font-figtree',
  display: 'swap',
})

export const bricolage = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', weight: '200 800' },
    { path: '../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2', weight: '200 800' },
  ],
  variable: '--font-bricolage',
  display: 'swap',
})

export const jetbrains = localFont({
  src: '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains',
  display: 'swap',
})

export const notoArabic = localFont({
  src: [
    { path: '../../../packages/fonts/files/NotoNaskhArabic-Regular.ttf', weight: '400' },
    { path: '../../../packages/fonts/files/NotoNaskhArabic-Bold.ttf', weight: '700' },
  ],
  variable: '--font-noto-arabic',
  display: 'swap',
})

export const fontVariables = [figtree, bricolage, jetbrains, notoArabic].map((f) => f.variable).join(' ')
