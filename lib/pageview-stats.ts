import { sharedCounter, type BatFetchStats } from './bat-fetch-stats'
import { observeHigh } from './records'
import { noteDaily } from './daily-history'

// Page loads, for the /bmstats status page: how many times a browser loaded a
// page of the site today (midnight to midnight, Bangkok) and in the past 60
// minutes, by type of page. Counted the same way PostHog counts page views —
// once per full page load, reported by the page itself — so the two can be
// compared. Saved to disk so a restart keeps the day.

const pageLoads = sharedCounter('__pageviewStats', 'pageview-stats.json', { countStarts: false })

const KNOWN = ['player', 'leaderboards', 'country-matrix', 'disclaimer', 'privacy', 'bmstats']
const MAX_PATH = 200

/** The type of page a path belongs to, or null if it is not a usable path. */
export function pageKind(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_PATH) return null
  const first = path.split('/')[1] ?? ''
  if (first === '') return 'home'
  return KNOWN.includes(first) ? first : 'other'
}

export function recordPageLoad(kind: string): void {
  pageLoads.record(kind, true)
  const { today, lastHour } = pageLoads.totals()
  observeHigh('pagesDay', today)
  observeHigh('pagesHour', lastHour)
  noteDaily('pages', today)
}

export function getPageviewStats(): BatFetchStats {
  return pageLoads.stats()
}
