'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { getDeviceId } from '@/lib/analytics'
import { HEARTBEAT_MS } from '@/lib/presence'

// Sends the /api/presence heartbeat from every route (it sits in the root
// layout) and shares the latest online count with whatever shows it. Pings
// only while the tab is visible, so background tabs drop off the count.

const PresenceContext = createContext<number | null>(null)

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState<number | null>(null)

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
        .then((data: { online?: number } | null) => {
          if (typeof data?.online === 'number') setOnline(data.online)
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

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>
}

/** Devices online right now, or null until the first heartbeat answers. */
export function useOnlineCount(): number | null {
  return useContext(PresenceContext)
}
