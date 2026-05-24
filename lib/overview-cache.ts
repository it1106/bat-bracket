import { batFetch } from '@/lib/bat-fetch'
import { parseOverviewNotes } from '@/lib/scraper'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export const TTL_MS = 30 * 60 * 1000

// notes: sanitized HTML strings from each info alert; empty array = no notes found
export const cache = new Map<string, { notes: string[]; ts: number; done?: boolean }>()

export async function fetchAndCache(id: string, done = false): Promise<string[]> {
  const url = `https://bat.tournamentsoftware.com/tournament/${id}`
  const res = await batFetch('overview', url, { headers: HEADERS })
  const notes = res.ok ? parseOverviewNotes(await res.text()) : []
  cache.set(id, { notes, ts: Date.now(), ...(done && { done: true }) })
  return notes
}
