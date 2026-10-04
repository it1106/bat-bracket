import { sharedCounter } from './bat-fetch-stats'

// Player-cache writes today, and how many failed, for /bmstats. A failed write
// means a scraped player was not remembered and will be scraped from BAT
// again — the signature of the request flood of 3 Oct 2026. It should read 0.

const writes = sharedCounter('__playerCacheStats', 'player-cache-stats.json', { countStarts: false })

export function recordPlayerCacheWrite(ok: boolean): void {
  writes.record('write', ok)
}

export function getPlayerCacheStats(): { writesToday: number; failedToday: number } {
  const { today, failedToday } = writes.totals()
  return { writesToday: today, failedToday }
}
