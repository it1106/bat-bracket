// Which announcement this browser has already acknowledged.
//
// One key, holding the id of the last announcement the visitor clicked OK on —
// not one key per announcement. The text is editable from /bmstats, so there is
// no bounded set of ids to keep keys for, and comparing against a single
// remembered id is what makes a changed announcement show again.

/** Longest announcement the owner can save. Lives here, not in the store, so
 *  client components can read it without pulling in a server-only module. */
export const MAX_ANNOUNCEMENT = 500

const SEEN_KEY = 'batbracket.announcementSeen'

export function lastSeenAnnouncement(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export function markAnnouncementSeen(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SEEN_KEY, id)
  } catch {}
}

// Which "new tournament" pop-ups this browser has already seen: the ids of the
// tournaments, newest last. Unlike the owner's announcement there can be
// several at once, so this is a set, capped so it cannot grow without end —
// an id falls off long after the server stops announcing it.
const NEWS_SEEN_KEY = 'batbracket.newTournamentsSeen'
const NEWS_SEEN_CAP = 100

export function seenNewTournaments(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NEWS_SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markNewTournamentsSeen(ids: readonly string[]): void {
  if (typeof window === 'undefined') return
  try {
    const seen = Array.from(seenNewTournaments()).filter((id) => !ids.includes(id))
    localStorage.setItem(NEWS_SEEN_KEY, JSON.stringify([...seen, ...ids].slice(-NEWS_SEEN_CAP)))
  } catch {}
}
