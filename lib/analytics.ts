'use client'

import posthog from 'posthog-js'

type Props = Record<string, unknown>

const DEVICE_ID_KEY = 'batbracket.deviceId'

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

function genDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {}
  return 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function identifyDevice(): void {
  if (!isLoaded()) return
  if (typeof window === 'undefined') return
  let id: string | null = null
  try {
    id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = genDeviceId()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
  } catch {
    return
  }
  posthog.identify(id)
}

export function setPersonProps(properties: Props): void {
  if (!isLoaded()) return
  posthog.setPersonProperties(properties)
}
