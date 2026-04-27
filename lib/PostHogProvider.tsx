'use client'

import { useEffect, type ReactNode } from 'react'
import posthog from 'posthog-js'
import { useLanguage } from './LanguageContext'
import { useTheme } from './ThemeContext'
import { registerGlobals } from './analytics'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'
// Vercel injects NEXT_PUBLIC_VERCEL_ENV ("production" | "preview" | "development")
// at build time. Empty on any non-Vercel build (LAN box, local dev). Hostname
// sniffing was wrong: custom domains pointed at Vercel got tagged "self-hosted"
// because they don't end in .vercel.app.
const VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV || ''
const APP_DEPLOYMENT = VERCEL_ENV ? 'vercel' : 'self-hosted'
const APP_ENVIRONMENT = VERCEL_ENV || 'production'

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
        posthog.register({
          app_deployment: APP_DEPLOYMENT,
          app_environment: APP_ENVIRONMENT,
        })
      },
    })
  }, [])

  useEffect(() => {
    registerGlobals({ app_language: lang, app_theme: theme })
  }, [lang, theme])

  return <>{children}</>
}
