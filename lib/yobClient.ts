'use client'

// Birth years for BAT players, as the schedule's tooltips need them. A birth
// year never changes, so once the server has told this browser, the browser
// keeps it (localStorage) and never asks again; what it does not have is asked
// for in one request for the whole day.
//
// It used to ask in chunks of 15 players on every schedule view and day
// switch — about 34 requests for a 500-player day, and 71% of all requests the
// site received.

const STORAGE_KEY = 'batbracket.yob'
/** Tournaments remembered at once; the least recently used are dropped. */
const MAX_TOURNAMENTS = 8
/** Most players asked about in one request. */
const MAX_IDS_PER_REQUEST = 1000

type Stored = Record<string, { at: number; years: Record<string, string> }>

function readStore(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Stored
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** The birth years this browser already knows for a tournament. */
export function loadStoredYobs(tournamentId: string): Record<string, string> {
  return { ...(readStore()[tournamentId.toLowerCase()]?.years ?? {}) }
}

/** Adds birth years to what this browser remembers for a tournament. */
export function storeYobs(tournamentId: string, years: Record<string, string>): void {
  if (Object.keys(years).length === 0) return
  try {
    const store = readStore()
    const key = tournamentId.toLowerCase()
    // Strictly later than every other entry, so "most recently used" holds
    // even for writes inside the same millisecond.
    const latest = Math.max(0, ...Object.values(store).map((entry) => entry.at ?? 0))
    store[key] = { at: Math.max(Date.now(), latest + 1), years: { ...(store[key]?.years ?? {}), ...years } }
    const keep = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_TOURNAMENTS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(keep)))
  } catch { /* storage full or unavailable: tooltips still work this session */ }
}

/** Asks the server for the birth years of `ids`, reporting them through
 *  `onYears` as they arrive and remembering them. The server answers from its
 *  cache for as many as it has and looks up a limited number of the rest per
 *  request, so this repeats with whoever is left until a request brings
 *  nothing new. Returns the ids the server did answer for (with or without a
 *  year), so the caller need not ask about them again this session. */
export async function fetchBatYobs(
  tournamentId: string,
  ids: string[],
  opts: { onYears: (years: Record<string, string>) => void; isCancelled?: () => boolean },
): Promise<string[]> {
  const attempted: string[] = []
  let pending = ids
  while (pending.length > 0 && !opts.isCancelled?.()) {
    let data: Record<string, { yob: string | null }>
    try {
      const res = await fetch('/api/bat/player-ages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament: tournamentId, ids: pending.slice(0, MAX_IDS_PER_REQUEST) }),
      })
      if (!res.ok) break
      data = (await res.json()) as Record<string, { yob: string | null }>
    } catch {
      break
    }
    const answered = Object.keys(data)
    if (answered.length === 0) break
    const years: Record<string, string> = {}
    for (const id of answered) {
      const yob = data[id]?.yob
      if (yob) years[id] = yob
    }
    attempted.push(...answered)
    storeYobs(tournamentId, years)
    if (opts.isCancelled?.()) break
    if (Object.keys(years).length > 0) opts.onYears(years)
    const done = new Set(answered)
    pending = pending.filter((id) => !done.has(id))
  }
  return attempted
}
