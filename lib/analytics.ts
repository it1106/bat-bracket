'use client'

import posthog from 'posthog-js'

type Props = Record<string, unknown>

function isLoaded(): boolean {
  return Boolean((posthog as unknown as { __loaded?: boolean }).__loaded)
}

export function track(event: string, properties?: Props): void {
  if (!isLoaded()) return
  posthog.capture(event, properties)
}

export function registerGlobals(properties: Props): void {
  if (!isLoaded()) return
  posthog.register(properties)
}
