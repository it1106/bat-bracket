import type { DiscoveryStore } from './discovery-store'
import type { TournamentInfo } from './types'
import type { NewsKind, SiteNews } from './site-news'

// What the site's news pop-up announces: tournaments the discovery cycle put
// into the dropdown recently, and draws and schedules published for the first
// time (lib/site-news.ts). Separate from the owner's announcement
// (lib/announcement-store.ts), which it never touches.

/** How long after it appears a tournament is still announced. A visitor who
 *  comes back later finds it in the dropdown anyway. */
export const NEWS_WINDOW_MS = 3 * 86_400_000

/** At most this many in one pop-up, newest first. */
export const NEWS_MAX = 5

export interface NewTournament {
  id: string
  name: string
  addedAt: string
}

/** `visible` is the list `/api/tournaments` serves (mergeForApi's output), so
 *  a denied or hidden tournament is never announced, and the name is the one
 *  the dropdown shows. */
export function recentlyAddedTournaments(
  discovered: DiscoveryStore,
  visible: readonly TournamentInfo[],
  now: number,
): NewTournament[] {
  const shown = new Map(visible.map((t) => [t.id.toUpperCase(), t]))
  const out: NewTournament[] = []
  for (const e of discovered.entries) {
    if (!e.hasBracket || !e.promotedAt) continue
    const at = Date.parse(e.promotedAt)
    if (!Number.isFinite(at) || at > now || now - at > NEWS_WINDOW_MS) continue
    const t = shown.get(e.id.toUpperCase())
    if (!t || t.done) continue
    out.push({ id: t.id, name: t.name, addedAt: e.promotedAt })
  }
  out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  return out.slice(0, NEWS_MAX)
}

export interface TournamentUpdate {
  id: string
  kind: NewsKind
  tournamentId: string
  tournamentName: string
  items: string[]
  addedAt: string
}

/** Draws and schedules published in the window (lib/site-news.ts), for
 *  tournaments the dropdown still shows and has not marked done, named as the
 *  dropdown names them. A schedule keeps only days from `todayIso` on, and is
 *  left out once all of them have passed. Newest first, capped. */
export function recentUpdates(
  news: SiteNews,
  visible: readonly TournamentInfo[],
  now: number,
  todayIso: string,
): TournamentUpdate[] {
  const shown = new Map(visible.map((t) => [t.id.toUpperCase(), t]))
  const out: TournamentUpdate[] = []
  for (const e of news.events) {
    const at = Date.parse(e.at)
    if (!Number.isFinite(at) || at > now || now - at > NEWS_WINDOW_MS) continue
    const t = shown.get(e.tournamentId.toUpperCase())
    if (!t || t.done) continue
    const items = e.kind === 'schedule' ? e.items.filter((d) => d >= todayIso) : e.items
    if (items.length === 0) continue
    out.push({ id: e.id, kind: e.kind, tournamentId: t.id, tournamentName: t.name, items, addedAt: e.at })
  }
  out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  return out.slice(0, NEWS_MAX)
}
