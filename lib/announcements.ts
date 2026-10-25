// Which announcement this browser has already acknowledged.
//
// One key, holding the id of the last announcement the visitor clicked OK on —
// not one key per announcement. The text is editable from /bmstats, so there is
// no bounded set of ids to keep keys for, and comparing against a single
// remembered id is what makes a changed announcement show again.

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
