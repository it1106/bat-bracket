'use client'
import { useCallback, useEffect, useState } from 'react'
import { track } from './analytics'

export interface PathTarget {
  drawNum: string
  drawName: string
  playerId: string
}

export interface PathContext {
  tournamentId: string
  tournamentName: string
}

/** Which player's path to the final is open. The path belongs to the player
 *  window it was opened from, so it is shown only while that window is open on
 *  the same player, and it is forgotten once the window closes or moves to
 *  someone else — it never comes back on its own. Opening one is reported to
 *  analytics here, so the event cannot drift from what actually opens. */
export function usePathTarget(openPlayerId: string | undefined) {
  const [target, setTarget] = useState<PathTarget | null>(null)

  useEffect(() => {
    if (target && target.playerId !== openPlayerId) setTarget(null)
  }, [target, openPlayerId])

  const openPath = useCallback((next: PathTarget, context: PathContext) => {
    track('path_to_final_opened', {
      tournament_id: context.tournamentId,
      tournament_name: context.tournamentName,
      draw: next.drawName,
      draw_id: next.drawNum,
    })
    setTarget(next)
  }, [])
  const closePath = useCallback(() => setTarget(null), [])

  return {
    pathTarget: target && target.playerId === openPlayerId ? target : null,
    openPath,
    closePath,
  }
}
