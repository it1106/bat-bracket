import { batFetch } from '@/lib/bat-fetch'
import { parseOverviewNotes, parseSeedEntries } from '@/lib/scraper'
import type { TournamentOverview } from '@/lib/types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export const TTL_MS = 30 * 60 * 1000

export const cache = new Map<string, { data: TournamentOverview; ts: number; done?: boolean }>()

export async function fetchAndCache(id: string, done = false): Promise<TournamentOverview> {
  const [overviewRes, seedsRes] = await Promise.allSettled([
    batFetch('overview', `https://bat.tournamentsoftware.com/tournament/${id}`, { headers: HEADERS }),
    batFetch('seeds', `https://bat.tournamentsoftware.com/sport/seeds.aspx?id=${id}`, { headers: HEADERS }),
  ])

  const notes = overviewRes.status === 'fulfilled' && overviewRes.value.ok
    ? parseOverviewNotes(await overviewRes.value.text())
    : []

  const seedEvents = seedsRes.status === 'fulfilled' && seedsRes.value.ok
    ? parseSeedEntries(await seedsRes.value.text())
    : []

  const data: TournamentOverview = { notes, seedEvents }
  cache.set(id, { data, ts: Date.now(), ...(done && { done: true }) })
  return data
}
