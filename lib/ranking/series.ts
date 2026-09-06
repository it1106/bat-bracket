// Helpers for resolving which ranking *series* a thing belongs to.
//
// BAT publishes two series (Open rid=289, Junior rid=189) since it retired
// the combined rid=188 list after the 28/7/2569 publication. Each has its
// own weekly publication id, and per-player detail pages live under that id
// — so anything that builds a `player.aspx?id=…` URL must resolve the id
// from the *event* the player was found in, not from the snapshot as a whole.

import type { Ranking, RankingEvent } from '@/lib/types'

/** The publication id to use for an event. Falls back to the snapshot's
 *  primary id for single-series providers and pre-split envelopes. */
export function rankingIdForEvent(ranking: Ranking, ev: RankingEvent): string {
  return ev.rankingId ?? ranking.rankingId
}

/** The publication id for a named event code (e.g. 'U15_MS'), or null when
 *  the snapshot has no such event. */
export function rankingIdForEventCode(ranking: Ranking, eventCode: string): string | null {
  const ev = ranking.events.find(e => e.eventCode === eventCode)
  return ev ? rankingIdForEvent(ranking, ev) : null
}

/** Map publication id → series id for this snapshot. Used to attribute a
 *  `player.aspx?id=<pub>` link found on an upstream profile page to the
 *  series it belongs to. */
export function seriesIdByRankingId(ranking: Ranking): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of ranking.series ?? []) m.set(s.rankingId, s.seriesId)
  return m
}

/** The publish date recorded for one series, falling back to the snapshot's
 *  primary publish date. */
export function publishDateForSeries(ranking: Ranking, seriesId: string): string {
  return ranking.series?.find(s => s.seriesId === seriesId)?.publishDate ?? ranking.publishDate
}
