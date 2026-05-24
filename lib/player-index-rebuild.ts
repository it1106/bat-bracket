import { createHash } from 'crypto'
import { listDoneByProvider } from '@/lib/tournaments-registry'
import { readFullCache, readDayCache } from '@/lib/day-cache'
import { readClubsCache, writeClubsCache } from '@/lib/clubs-cache'
import { playerClubCache, fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import {
  readIndexCache, writeIndexCache, writeLeaderboardsCache,
} from '@/lib/player-index-cache'
import { buildIndex } from '@/lib/playerIndex'
import type { ProviderTag, PlayerIndexTournamentInput, MatchesData, MatchScheduleGroup } from '@/lib/types'

const PROVIDERS: ProviderTag[] = ['bat', 'bwf']
let inflight: Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> | null = null

export async function rebuildAll(): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> {
  if (inflight) return inflight
  inflight = (async () => {
    const rebuilt: ProviderTag[] = []
    const skipped: ProviderTag[] = []
    for (const provider of PROVIDERS) {
      try {
        const done = listDoneByProvider(provider)
        if (done.length === 0) { skipped.push(provider); continue }

        const inputs: PlayerIndexTournamentInput[] = []
        for (const entry of done) {
          const full = await readFullCache(entry.id)
          if (!full) continue

          let clubs = await readClubsCache(entry.id)
          if (!clubs && provider === 'bat') {
            await fetchTournamentPlayerClubs(entry.id.toLowerCase()).catch(() => null)
            const prefix = `${entry.id.toLowerCase()}:`
            const fresh: Record<string, string> = {}
            playerClubCache.forEach((club, key) => {
              if (key.startsWith(prefix)) fresh[key.slice(prefix.length)] = club
            })
            if (Object.keys(fresh).length > 0) {
              await writeClubsCache(entry.id, fresh)
              clubs = fresh
            }
          }

          // Walk all per-day caches and union groups so the aggregator sees every match.
          // .cache/full/<id>.json only holds the currentDate's groups.
          const allGroups: MatchScheduleGroup[] = []
          for (const d of full.days || []) {
            if (!d.dateIso) continue
            const day = await readDayCache(entry.id, d.dateIso)
            if (day?.groups) allGroups.push(...day.groups)
          }
          if (allGroups.length === 0 && full.groups?.length) {
            allGroups.push(...full.groups)
          }
          const mergedData: MatchesData = { ...full, groups: allGroups }

          inputs.push({
            tournamentId: entry.id,
            tournamentName: entry.name || entry.id,
            tournamentDateIso: full.days?.[0]?.dateIso || '',
            data: mergedData,
            clubs: clubs || {},
          })
        }

        const sv = computeSourceVersion(inputs)
        const existing = await readIndexCache(provider)
        if (existing && existing.sourceVersion === sv) { skipped.push(provider); continue }

        const { index, leaderboards } = buildIndex(provider, inputs)
        const now = new Date().toISOString()
        index.generatedAt = now
        leaderboards.generatedAt = now
        index.sourceVersion = sv
        leaderboards.sourceVersion = sv

        await writeIndexCache(index)
        await writeLeaderboardsCache(leaderboards)
        rebuilt.push(provider)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        console.log(`[player-index-rebuild] failed provider=${provider} err=${msg}`)
        skipped.push(provider)
      }
    }
    return { rebuilt, skipped }
  })()
  try { return await inflight } finally { inflight = null }
}

function computeSourceVersion(inputs: PlayerIndexTournamentInput[]): string {
  const sig = [...inputs]
    .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
    .map(i => `${i.tournamentId}:${JSON.stringify(i.data).length}:${Object.keys(i.clubs).length}`)
    .join('|')
  return createHash('sha256').update(sig).digest('hex')
}
