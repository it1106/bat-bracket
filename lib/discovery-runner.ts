import type { UpcomingEntry } from './upcoming-scraper'
import type { DiscoveredEntry, DiscoveryStore } from './discovery-store'
import type { DrawInfo } from './types'

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

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<void> {
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
