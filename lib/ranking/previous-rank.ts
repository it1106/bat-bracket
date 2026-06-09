import type { Ranking, RankingEvent } from '@/lib/types'

/**
 * Stamp `previousRank` onto each entry in `next` by looking up the matching
 * (eventCode, slug) in `prev`. Two regimes:
 *
 *  - `prev.publishDate !== nextPublishDate` (new week): take rank from prev.
 *  - `prev.publishDate === nextPublishDate` (same-week force-refresh): copy
 *    prev's `previousRank` through, so re-refreshing inside a week doesn't
 *    wipe the genuine prior-week delta.
 *
 * Pure: returns a fresh array of events; does not mutate inputs.
 */
export function mergePreviousRanks(
  prev: Ranking | null,
  next: RankingEvent[],
  nextPublishDate: string,
): RankingEvent[] {
  if (!prev) return next.map(cloneEvent)
  const sameWeek = prev.publishDate === nextPublishDate
  const lookup = new Map<string, Map<string, number>>()
  for (const ev of prev.events) {
    const inner = new Map<string, number>()
    for (const e of ev.entries) {
      const v = sameWeek ? e.previousRank : e.rank
      if (typeof v === 'number') inner.set(e.slug, v)
    }
    lookup.set(ev.eventCode, inner)
  }
  return next.map(ev => ({
    ...ev,
    entries: ev.entries.map(e => {
      const pr = lookup.get(ev.eventCode)?.get(e.slug)
      return pr === undefined ? { ...e } : { ...e, previousRank: pr }
    }),
  }))
}

function cloneEvent(ev: RankingEvent): RankingEvent {
  return { ...ev, entries: ev.entries.map(e => ({ ...e })) }
}
