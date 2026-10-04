'use client'

// Tournaments this browser has found to have no live scoring. BAT marks
// matches "Now playing" whether or not the tournament feeds the live-score
// service, so the page can only find out by connecting and getting no courts.
// Without a memory of that it connected again on every page load and every
// return to the tab — two requests each time, some 14,000 a day for one
// tournament that never had live scores.

const STORAGE_KEY = 'batbracket.liveScoreAbsent'
/** How long an empty answer is believed; scoring can be switched on mid-event. */
export const LIVE_SCORE_RETRY_MS = 30 * 60_000

type Stored = Record<string, number>

function readStore(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Stored
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Did this tournament come up empty recently enough not to ask again? */
export function isLiveScoreAbsent(tournamentId: string): boolean {
  const at = readStore()[tournamentId.toLowerCase()]
  return typeof at === 'number' && Date.now() - at < LIVE_SCORE_RETRY_MS
}

export function noteLiveScoreAbsent(tournamentId: string): void {
  try {
    const now = Date.now()
    const fresh = Object.entries(readStore()).filter(([, at]) => now - at < LIVE_SCORE_RETRY_MS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...Object.fromEntries(fresh), [tournamentId.toLowerCase()]: now }))
  } catch { /* storage unavailable: it is simply tried again */ }
}
