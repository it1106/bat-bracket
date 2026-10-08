'use client'
import { useCallback, useEffect, useState } from 'react'

export interface PathTarget {
  drawNum: string
  drawName: string
  playerId: string
}

/** Which player's path to the final is open. The path belongs to the player
 *  window it was opened from, so it is shown only while that window is open on
 *  the same player, and it is forgotten once the window closes or moves to
 *  someone else — it never comes back on its own. */
export function usePathTarget(openPlayerId: string | undefined) {
  const [target, setTarget] = useState<PathTarget | null>(null)

  useEffect(() => {
    if (target && target.playerId !== openPlayerId) setTarget(null)
  }, [target, openPlayerId])

  const openPath = useCallback((next: PathTarget) => setTarget(next), [])
  const closePath = useCallback(() => setTarget(null), [])

  return {
    pathTarget: target && target.playerId === openPlayerId ? target : null,
    openPath,
    closePath,
  }
}
