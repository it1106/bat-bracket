'use client'

import { useEffect, useRef, useState } from 'react'
import { LiveScoreClient, type CourtLive, type State } from './live-score'
import { track } from './analytics'

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
    // Per-connection state so each reconnect cycle re-emits the
    // "first time we hit active" signal as a fresh live_view_active.
    let prevState: State | null = null

    const start = () => {
      if (clientRef.current) return
      const client = new LiveScoreClient()
      clientRef.current = client
      prevState = null
      client.on('state', (state) => {
        if (state === prevState) return
        track('signalr_state_changed', {
          tournament_id: tournamentId,
          from: prevState ?? 'init',
          to: state,
        })
        if (state === 'active' && prevState !== 'active') {
          track('live_view_active', { tournament_id: tournamentId })
        }
        prevState = state
      })
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
