import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BAT Unofficial Scoreboard',
    short_name: 'BAT Scoreboard',
    description: 'Tournament bracket viewer for bat.tournamentsoftware.com',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f0f2f5',
    theme_color: '#25316B',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
