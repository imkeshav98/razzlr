import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dazbee',
    short_name: 'Dazbee',
    start_url: '/',
    display: 'standalone',
    background_color: '#15121A',
    theme_color: '#0e0c11',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
