import type { UpcomingEntry } from './upcoming-scraper'
import type { DiscoveredEntry, DiscoveryStore } from './discovery-store'
import type { DrawInfo } from './types'
import { batFetch } from './bat-fetch'
import { parseUpcoming } from './upcoming-scraper'
import { parseTournamentDraws, bracketHasSeededPlayers } from './scraper'
import { loadDiscovered, saveDiscovered } from './discovery-store'
import { captureServerEvent } from './posthog-server'

export interface DiscoveryDeps {
  fetchUpcomingHtml: () => Promise<string>
  parseUpcoming: (html: string) => UpcomingEntry[]
  fetchDrawsHtml: (id: string) => Promise<string>
  parseTournamentDraws: (html: string) => DrawInfo[]
  fetchDrawContentHtml: (id: string, drawNum: string) => Promise<string>
  bracketHasSeededPlayers: (html: string) => boolean
  loadDiscovered: () => Promise<DiscoveryStore>
  saveDiscovered: (s: DiscoveryStore) => Promise<void>
  captureServerEvent: (event: string, props: Record<string, unknown>) => Promise<void>
  log: (msg: string) => void
  warn: (msg: string) => void
  now: () => Date
}

let cycleInFlight = false

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<void> {
  if (cycleInFlight) {
    deps.log('[discovery] cycle still in flight, skipping')
    return
  }
  cycleInFlight = true
  try {
    await runDiscoveryCycleInner(deps)
  } finally {
    cycleInFlight = false
  }
}

async function runDiscoveryCycleInner(deps: DiscoveryDeps): Promise<void> {
  const html = await deps.fetchUpcomingHtml()
  const upcomingAll = deps.parseUpcoming(html)
  const upcoming = upcomingAll.filter((u) => !u.hasOnlineEntry)
  const store = await deps.loadDiscovered()
  const nowIso = deps.now().toISOString()

  const existingById = new Map(store.entries.map((e) => [e.id, e]))
  const nextById = new Map(existingById)

  for (const u of upcoming) {
    const existing = nextById.get(u.id)
    if (existing) {
      existing.lastSeenOnUpcomingAt = nowIso
      existing.name = u.name
      if (existing.hasBracket) continue
      const promoted = await runBracketGate(deps, u.id)
      if (promoted) existing.hasBracket = true
    } else {
      const promoted = await runBracketGate(deps, u.id)
      const entry: DiscoveredEntry = {
        id: u.id,
        name: u.name,
        hasBracket: promoted,
        discoveredAt: nowIso,
        lastSeenOnUpcomingAt: nowIso,
      }
      nextById.set(u.id, entry)
    }
  }

  // Cleanup pass. Skip entirely if the upcoming snapshot looks suspicious
  // (zero entries when we previously had some) — likely a parser regression
  // or a transient BAT hiccup, and we don't want to mass-remove on it.
  const upcomingIds = new Set(upcoming.map((u) => u.id))
  const suspicious = upcoming.length === 0 && store.entries.length > 0
  if (suspicious) {
    deps.warn('[discovery] empty snapshot vs non-empty store — skipping cleanup')
  } else {
    for (const id of Array.from(nextById.keys())) {
      const e = nextById.get(id)!
      if (upcomingIds.has(id)) continue
      if (e.hasBracket) continue
      nextById.delete(id)
    }
  }

  const nextEntries = Array.from(nextById.values())
  const newStore: DiscoveryStore = { version: 1, entries: nextEntries }
  await deps.saveDiscovered(newStore)

  for (const e of nextEntries) {
    const prev = existingById.get(e.id)
    if (e.hasBracket && (!prev || !prev.hasBracket)) {
      deps.log(`[discovery] added ${e.id} ${e.name}`)
      await deps.captureServerEvent('tournament_auto_added', {
        id: e.id,
        name: e.name,
      })
    }
  }
  for (const [id, prev] of Array.from(existingById)) {
    if (!nextById.has(id)) {
      deps.log(`[discovery] removed ${id} ${prev.name}`)
      await deps.captureServerEvent('tournament_auto_removed', { id, name: prev.name })
    }
  }
}

async function runBracketGate(deps: DiscoveryDeps, id: string): Promise<boolean> {
  try {
    const drawsHtml = await deps.fetchDrawsHtml(id)
    const draws = deps.parseTournamentDraws(drawsHtml)
    if (draws.length === 0) return false
    const contentHtml = await deps.fetchDrawContentHtml(id, draws[0].drawNum)
    return deps.bracketHasSeededPlayers(contentHtml)
  } catch {
    return false
  }
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export function buildDefaultDeps(): DiscoveryDeps {
  return {
    fetchUpcomingHtml: async () => {
      const res = await batFetch(
        'discovery-upcoming',
        'https://bat.tournamentsoftware.com/Home/DoTournamentSearch?Page=1&SelectedTab=Upcoming',
        {
          headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' },
          cache: 'no-store',
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    parseUpcoming,
    fetchDrawsHtml: async (id) => {
      const res = await batFetch(
        'discovery-draws',
        `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${id}`,
        { headers: HEADERS, cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    parseTournamentDraws,
    fetchDrawContentHtml: async (id, drawNum) => {
      const url = `https://bat.tournamentsoftware.com/tournament/${id}/Draw/${drawNum}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
      const res = await batFetch('discovery-draw-content', url, {
        headers: {
          ...HEADERS,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*; q=0.01',
          Referer: `https://bat.tournamentsoftware.com/tournament/${id}/draw/${drawNum}`,
        },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    bracketHasSeededPlayers,
    loadDiscovered,
    saveDiscovered,
    captureServerEvent,
    log: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    now: () => new Date(),
  }
}
