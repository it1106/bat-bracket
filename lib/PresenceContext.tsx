'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { getDeviceId } from '@/lib/analytics'
import { HEARTBEAT_MS } from '@/lib/presence'

// Sends the /api/presence heartbeat from every route (it sits in the root
// layout) and shares the latest online count, today's peak and today's
// distinct devices with whatever shows them. Pings only while the tab is visible, so background tabs drop off
// the count.

export interface Presence {
  online: number
  peak: number
  users: number
}

const PresenceContext = createContext<Presence | null>(null)

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [presence, setPresence] = useState<Presence | null>(null)

  // One page-load report per full page load, visible or not, for the page
  // count on /bmstats. This provider sits in the root layout, so it mounts
  // exactly once per load and not on in-app navigation.
  useEffect(() => {
    fetch('/api/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const id = getDeviceId()
    if (!id) return
    let timer: ReturnType<typeof setInterval> | null = null

    const ping = () => {
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { online?: number; peak?: number; users?: number } | null) => {
          if (typeof data?.online !== 'number') return
          const peak = typeof data.peak === 'number' ? data.peak : data.online
          const users = typeof data.users === 'number' ? data.users : peak
          setPresence({ online: data.online, peak, users })
        })
        .catch(() => {})
    }
    const start = () => {
      if (timer) return
      ping()
      timer = setInterval(ping, HEARTBEAT_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
}

/** Devices online right now, today's peak and today's distinct devices, or
 *  null until the first heartbeat answers. */
export function usePresence(): Presence | null {
  return useContext(PresenceContext)
}
