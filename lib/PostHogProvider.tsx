'use client'

import { useEffect, type ReactNode } from 'react'
import posthog from 'posthog-js'
import { useLanguage } from './LanguageContext'
import { useTheme } from './ThemeContext'
import { identifyDevice, registerGlobals } from './analytics'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
// Default to the same-origin reverse proxy defined in next.config.js so
// ad-blockers don't drop events. Override with an absolute URL only if you
// know what you're doing (e.g. a deployment that can't run the rewrite).
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest'
// PostHog dashboard generates session-replay / person links against ui_host;
// keep it on the real PostHog UI domain so those links resolve.
const UI_HOST = 'https://eu.posthog.com'
// Sent with every event. There is one deployment now, but dashboards built
// when there were two still filter on these, so the values stay as they were.
const APP_DEPLOYMENT = 'self-hosted'
const APP_ENVIRONMENT = 'production'

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage()
  const { theme } = useTheme()

  useEffect(() => {
    if (!KEY) return
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return
    // TODO(consent): add cookie banner if EU traffic exceeds ~5%
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: UI_HOST,
      capture_pageview: true,
      autocapture: false,
      // Web Vitals (LCP/INP/CLS/...) reported per pageview.
      capture_performance: { web_vitals: true },
      // Hooks window.onerror + unhandledrejection so JS errors flow to PostHog
      // as $exception events. Critical for catching prod regressions early.
      capture_exceptions: true,
      persistence: 'localStorage',
      loaded: () => {
        posthog.register({
          app_deployment: APP_DEPLOYMENT,
          app_environment: APP_ENVIRONMENT,
        })
        identifyDevice()
      },
    })
  }, [])

  useEffect(() => {
    registerGlobals({ app_language: lang, app_theme: theme })
  }, [lang, theme])

  return <>{children}</>
}
