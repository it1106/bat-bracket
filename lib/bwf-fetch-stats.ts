import { sharedCounter, type BatFetchStats } from './bat-fetch-stats'

// Requests the headless browser makes to the BWF API, for /bmstats: today's
// total, failures and the past 60 minutes. Saved to disk like the BAT counts.

const bwfFetches = sharedCounter('__bwfFetchStats', 'bwf-fetch-stats.json', { countStarts: false })

export function recordBwfFetch(path: string, ok: boolean): void {
  const kind = path.split('?')[0].split('/').filter(Boolean)[0] ?? 'other'
  bwfFetches.record(kind, ok)
}

export function getBwfFetchStats(): BatFetchStats {
  return bwfFetches.stats()
}
