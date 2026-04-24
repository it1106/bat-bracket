'use client'

import { useEffect, useRef, useState } from 'react'
import { LiveScoreClient, type CourtLive } from './live-score'

export function useLiveScore(
  tournamentId: string | null,
  gateOpen: boolean,
): Map<string, CourtLive> {
  const [map, setMap] = useState<Map<string, CourtLive>>(() => new Map())
  const clientRef = useRef<LiveScoreClient | null>(null)

  useEffect(() => {
    if (!tournamentId || !gateOpen) {
      clientRef.current?.disconnect()
      clientRef.current = null
      setMap(new Map())
      return
    }
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null

    const start = () => {
      if (clientRef.current) return
      const client = new LiveScoreClient()
      clientRef.current = client
      client.on('scoreboard', (courts) => {
        const next = new Map<string, CourtLive>()
        for (const c of courts) next.set(c.courtKey, c)
        setMap(next)
      })
      client.connect(tournamentId)
    }
    const stop = () => {
      clientRef.current?.disconnect()
      clientRef.current = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => { stop() }, 60000)
      } else {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null }
        // Mobile OSes silently suspend background WebSockets; the JS client
        // often thinks it's still connected after a short tab switch.
        // Force a fresh handshake on every return to foreground.
        stop()
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (hiddenTimer) clearTimeout(hiddenTimer)
      stop()
    }
  }, [tournamentId, gateOpen])

  return map
}
