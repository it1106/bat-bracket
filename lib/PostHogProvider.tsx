'use client'

import { useEffect, type ReactNode } from 'react'
import posthog from 'posthog-js'
import { useLanguage } from './LanguageContext'
import { useTheme } from './ThemeContext'
import { registerGlobals } from './analytics'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

function detectDeployment(): 'vercel' | 'self-hosted' {
  if (typeof window === 'undefined') return 'self-hosted'
  return window.location.host.endsWith('.vercel.app') ? 'vercel' : 'self-hosted'
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage()
  const { theme } = useTheme()

  useEffect(() => {
    if (!KEY) return
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return
    // TODO(consent): add cookie banner if EU traffic exceeds ~5%
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: true,
      autocapture: false,
      persistence: 'localStorage',
      loaded: () => {
        posthog.register({ app_deployment: detectDeployment() })
      },
    })
  }, [])

  useEffect(() => {
    registerGlobals({ app_language: lang, app_theme: theme })
  }, [lang, theme])

  return <>{children}</>
}
