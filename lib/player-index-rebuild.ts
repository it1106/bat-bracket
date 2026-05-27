import { createHash } from 'crypto'
import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'
import { readFullCache, readDayCache } from '@/lib/day-cache'
import { readClubsCache, writeClubsCache } from '@/lib/clubs-cache'
import { playerClubCache, fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import {
  readIndexCache, writeIndexCache, writeLeaderboardsCache,
  readIdentityMap, writeIdentityMap, readPlayerLinks,
} from '@/lib/player-index-cache'
import { buildIndex } from '@/lib/playerIndex'
import { buildIdentityMap } from '@/lib/player-identity'
import { buildCombinedIndex, combinedSourceVersion } from '@/lib/player-index-merge'
import type { ProviderTag, PlayerIndex, PlayerIndexTournamentInput, MatchesData, MatchScheduleGroup } from '@/lib/types'

const PROVIDERS: ProviderTag[] = ['bat', 'bwf']
let inflight: Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> | null = null

// Fetches one day's match groups through the local /api/matches route, which
// pins a complete past day to .cache/days. Used to fill day caches that haven't
// been pinned by user traffic yet (e.g. a fresh server). `date` is the raw
// Buddhist-year token the matches route expects (MatchDay.date).
export type EnsureDay = (tournamentId: string, dateBuddhist: string) => Promise<MatchScheduleGroup[] | null>

export function makeOriginDayFetcher(origin: string): EnsureDay {
  return async (tournamentId, dateBuddhist) => {
    try {
      const res = await fetch(`${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}&date=${dateBuddhist}`)
      if (!res.ok) return null
      const data = await res.json() as { groups?: MatchScheduleGroup[] }
      return data.groups ?? null
    } catch {
      return null
    }
  }
}

export async function rebuildAll(opts?: { ensureDay?: EnsureDay }): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> {
  if (inflight) return inflight
  inflight = (async () => {
    const rebuilt: ProviderTag[] = []
    const skipped: ProviderTag[] = []
    const builtIndexes = new Map<ProviderTag, PlayerIndex>()
    for (const provider of PROVIDERS) {
      try {
        // A tournament belongs in the index once it's entirely in the past,
        // which is exactly when .cache/full/<id>.json gets pinned. We don't
        // require the manual [done] marker — any tournament with a pinned full
        // cache is complete and stable enough to aggregate. Candidates come
        // from both the manual registry and the auto-discovered set (e.g.
        // กีฬาเยาวชนแห่งชาติ), which is BAT-only.
        const candidates = new Map<string, { id: string; name?: string }>()
        for (const e of listAllTournaments()) {
          if (e.provider === provider) candidates.set(e.id.toUpperCase(), { id: e.id, name: e.name })
        }
        if (provider === 'bat') {
          const disc = await loadDiscovered()
          for (const e of disc.entries) {
            const key = e.id.toUpperCase()
            if (!candidates.has(key)) candidates.set(key, { id: key, name: e.name })
          }
        }

        const inputs: PlayerIndexTournamentInput[] = []
        for (const entry of Array.from(candidates.values())) {
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
          // .cache/full/<id>.json only holds the currentDate's groups. Stamp each
          // match with its day's calendar date (BAT entries carry no usable date),
          // which the aggregator uses for recent-form ordering and the date label.
          const stamp = (groups: MatchScheduleGroup[], dateIso: string): MatchScheduleGroup[] => {
            for (const g of groups) for (const m of g.matches) m.dateIso = dateIso
            return groups
          }
          const allGroups: MatchScheduleGroup[] = []
          for (const d of full.days || []) {
            if (!d.dateIso) continue
            const day = await readDayCache(entry.id, d.dateIso)
            if (day?.groups) { allGroups.push(...stamp(day.groups, d.dateIso)); continue }
            // Day not pinned yet (fresh server): fetch through the matches route,
            // which pins it for next time. No-op when no fetcher is supplied.
            if (opts?.ensureDay && d.date) {
              const groups = await opts.ensureDay(entry.id, d.date)
              if (groups) allGroups.push(...stamp(groups, d.dateIso))
            }
          }
          if (allGroups.length === 0 && full.groups?.length) {
            const todayIso = full.days?.find(d => d.date === full.currentDate)?.dateIso || ''
            allGroups.push(...stamp(full.groups, todayIso))
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

        // No past tournaments for this provider — don't clobber any prior index.
        if (inputs.length === 0) { skipped.push(provider); continue }

        const sv = computeSourceVersion(inputs)
        const existing = await readIndexCache(provider)
        if (existing && existing.sourceVersion === sv) { skipped.push(provider); continue }

        const { index, leaderboards } = buildIndex(provider, inputs)
        const now = new Date().toISOString()
        index.generatedAt = now
        leaderboards.generatedAt = now
        index.sourceVersion = sv
        leaderboards.sourceVersion = sv

        builtIndexes.set(provider, index)
        await writeIndexCache(index)
        await writeLeaderboardsCache(leaderboards)
        rebuilt.push(provider)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        console.log(`[player-index-rebuild] failed provider=${provider} err=${msg}`)
        skipped.push(provider)
      }
    }

    // Combined step: runs if both bat and bwf indexes are available
    try {
      const batIdx = builtIndexes.get('bat') ?? await readIndexCache('bat')
      const bwfIdx = builtIndexes.get('bwf') ?? await readIndexCache('bwf')
      if (batIdx && bwfIdx) {
        const existingMap = await readIdentityMap()
        const playerLinks = await readPlayerLinks()
        const identityMap = buildIdentityMap(batIdx, bwfIdx, existingMap, playerLinks)
        identityMap.generatedAt = new Date().toISOString()
        await writeIdentityMap(identityMap)

        const sv = combinedSourceVersion(batIdx.sourceVersion, bwfIdx.sourceVersion)
        const existingCombined = await readIndexCache('combined')
        if (existingCombined && existingCombined.sourceVersion === sv) {
          skipped.push('combined')
        } else {
          const { index, leaderboards } = buildCombinedIndex(batIdx, bwfIdx, identityMap)
          const now = new Date().toISOString()
          index.generatedAt = now
          leaderboards.generatedAt = now
          index.sourceVersion = sv
          leaderboards.sourceVersion = sv
          await writeIndexCache(index)
          await writeLeaderboardsCache(leaderboards)
          rebuilt.push('combined')
        }
      } else {
        skipped.push('combined')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.log(`[player-index-rebuild] failed provider=combined err=${msg}`)
      skipped.push('combined')
    }

    return { rebuilt, skipped }
  })()
  try { return await inflight } finally { inflight = null }
}

// Bump when the PlayerRecord/Leaderboard shape changes so a deploy forces a
// rebuild even though the underlying tournament data is unchanged. (sourceVersion
// otherwise only reflects input data, so a pure code change would be skipped.)
const SCHEMA_VERSION = 9

function computeSourceVersion(inputs: PlayerIndexTournamentInput[]): string {
  const sig = [...inputs]
    .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
    .map(i => `${i.tournamentId}:${JSON.stringify(i.data).length}:${Object.keys(i.clubs).length}`)
    .join('|')
  return createHash('sha256').update(`v${SCHEMA_VERSION}|${sig}`).digest('hex')
}
