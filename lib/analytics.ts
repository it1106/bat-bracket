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

/** This browser's persistent device id, created on first use. Null when
 *  localStorage is unavailable (private mode, blocked storage). */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = genDeviceId()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function identifyDevice(): void {
  if (!isLoaded()) return
  const id = getDeviceId()
  if (!id) return
  posthog.identify(id)
}

export function setPersonProps(properties: Props): void {
  if (!isLoaded()) return
  posthog.setPersonProperties(properties)
}
