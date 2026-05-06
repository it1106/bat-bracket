import { readFileSync } from 'fs'
import { join } from 'path'
import { batFetch } from './bat-fetch'
import { parseMatchesFull } from './scraper'
import { readFullCache, writeFullCache, isAllPast } from './day-cache'
import { getTodayIso } from './today'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
}

function readTournamentIds(): string[] {
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(' ')[0].toUpperCase())
  } catch {
    return []
  }
}

// Persists the full match schedule to disk if every match-day is in the past.
// Returns true iff a disk cache exists after this call (already-pinned or
// newly-pinned). A `false` return means the tournament is still active.
export async function ensureFullCachePersisted(
  tournamentId: string,
  todayIso: string,
): Promise<boolean> {
  if (await readFullCache(tournamentId)) return true
  const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
  const res = await batFetch('matches-full-prewarm', url, { headers: HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = parseMatchesFull(await res.text())
  if (!isAllPast(data, todayIso)) return false
  await writeFullCache(tournamentId, data)
  return true
}

// Pre-fetches the full match schedule for every tournament. Pinned past
// tournaments are skipped immediately (disk hit). Active tournaments incur
// one BAT round-trip but produce no disk write.
export async function prewarmMatchesFullCache(): Promise<void> {
  const ids = readTournamentIds()
  const todayIso = getTodayIso()
  for (const id of ids) {
    try {
      const persisted = await ensureFullCachePersisted(id, todayIso)
      console.log(`[matches-full-cache] pre-warmed: ${id}${persisted ? ' (persisted)' : ' (active)'}`)
    } catch (err) {
      console.warn(`[matches-full-cache] failed to pre-warm ${id}:`, err)
    }
  }
}
