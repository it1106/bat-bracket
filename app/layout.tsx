import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { LanguageProvider } from '@/lib/LanguageContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { PostHogProvider } from '@/lib/PostHogProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'BAT Unofficial Scoreboard',
  description: 'Tournament bracket viewer for bat.tournamentsoftware.com',
}

const NO_FLASH = `
(function(){try{var t=localStorage.getItem('bat-theme');if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();
`.trim()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <PostHogProvider>
              {children}
            </PostHogProvider>
          </ThemeProvider>
        </LanguageProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
