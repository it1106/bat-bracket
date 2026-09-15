import type { Ranking, RankingEntry, RankingEvent } from '@/lib/types'

/** Identity of a ranking row across publications.
 *
 *  Not the slug. BAT ranks doubles and mixed per pairing, so one player can
 *  hold several rows in the same event — keying on their slug collapses all
 *  of them onto one Map entry and hands every pairing the same (wrong) delta.
 *  The pair's player ids identify the row; they are SORTED because nothing
 *  upstream guarantees a pairing keeps its listed order between weeks, and an
 *  as-listed key would silently lose the delta on a flip.
 *
 *  Falls back to the slug when `players` is absent — singles rows, and any
 *  snapshot cached before the field existed. */
function rowKey(e: RankingEntry): string {
  const ids = (e.players ?? []).map((p) => p.globalPlayerId ?? p.slug).filter(Boolean)
  if (ids.length === 0) return `slug:${e.slug}`
  return `pair:${ids.slice().sort().join('|')}`
}

/**
 * Stamp `previousRank` onto each entry in `next` by looking up the matching
 * (eventCode, row identity) in `prev` — see `rowKey`. Two regimes:
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
      if (typeof v === 'number') inner.set(rowKey(e), v)
    }
    lookup.set(ev.eventCode, inner)
  }
  return next.map(ev => ({
    ...ev,
    entries: ev.entries.map(e => {
      const pr = lookup.get(ev.eventCode)?.get(rowKey(e))
      return pr === undefined ? { ...e } : { ...e, previousRank: pr }
    }),
  }))
}

function cloneEvent(ev: RankingEvent): RankingEvent {
  return { ...ev, entries: ev.entries.map(e => ({ ...e })) }
}
