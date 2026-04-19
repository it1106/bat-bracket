import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BAT Unofficial Brackets',
  description: 'Tournament bracket viewer for bat.tournamentsoftware.com',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
