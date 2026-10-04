'use client'

import { useSyncExternalStore } from 'react'

// When BAT went down, as the server last told this browser (the
// X-Bat-Down-Since header on a response served from cache). A tiny store, so
// the many places that read a schedule response need only hand the response
// over, and the warning banner picks the time up by itself.

let since: string | null = null
const listeners = new Set<() => void>()

/** Takes the outage start from a response served from cache, if it says. */
export function noteBatDownSince(res: Response): void {
  const value = res.headers.get('X-Bat-Down-Since')
  if (!value || value === since) return
  since = value
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** ISO time BAT went down, or null if the server has not said. */
export function useBatDownSince(): string | null {
  return useSyncExternalStore(subscribe, () => since, () => null)
}

/** "23:31" in Bangkok time; with the date in front ("4 Oct 23:31") once the
 *  outage is old enough that the time alone would be ambiguous. */
export function formatDownSince(iso: string, now: number): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
  if (now - at.getTime() < 20 * 3600_000) return time
  const date = at.toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })
  return `${date} ${time}`
}

export function __resetBatDownSinceForTesting(): void {
  since = null
}
