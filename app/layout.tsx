import type { Metadata, Viewport } from 'next'
import { LanguageProvider } from '@/lib/LanguageContext'
import { ThemeProvider } from '@/lib/ThemeContext'
import { PostHogProvider } from '@/lib/PostHogProvider'
import IOSInstallBanner from '@/components/IOSInstallBanner'
import './globals.css'

export const metadata: Metadata = {
  title: 'BAT Unofficial Scoreboard',
  description: 'Tournament bracket viewer for bat.tournamentsoftware.com',
  applicationName: 'BAT Scoreboard',
  appleWebApp: {
    capable: true,
    title: 'BAT Scoreboard',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#25316B' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
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
              <IOSInstallBanner />
            </PostHogProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  )
}
