import type { DiscoveryStore } from './discovery-store'
import type { TournamentInfo } from './types'

export function mergeForApi(
  manualEntries: TournamentInfo[],
  denySet: Set<string>,
  discovered: DiscoveryStore,
): TournamentInfo[] {
  const byId = new Map<string, TournamentInfo>()
  for (const e of discovered.entries) {
    if (!e.hasBracket) continue
    byId.set(e.id, { id: e.id, name: e.name })
  }
  // Manual wins on conflict.
  for (const e of manualEntries) {
    byId.set(e.id, e)
  }
  return Array.from(byId.values()).filter((e) => !denySet.has(e.id))
}
