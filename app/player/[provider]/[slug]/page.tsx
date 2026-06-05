import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, RankingPlayerRank, RankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  const playerRankings: RankingPlayerRank[] = []
  let rankingPublishDate = ''
  let initialDetail: RankingPlayerDetail | undefined

  const currentRanking = await readRankingCache(provider)
  if (currentRanking) {
    rankingPublishDate = currentRanking.publishDate
    let bwfGlobalPlayerId = ''
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug)
      if (entry) {
        playerRankings.push({
          eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments,
        })
        if (entry.globalPlayerId) bwfGlobalPlayerId = entry.globalPlayerId
      }
    }

    // SSR pre-fetch the per-player detail when we already know the id and the
    // cache is fresh against the current publishDate. BAT gets its id from
    // the slug↔id map (built by the 3-hop discovery on first request); BWF
    // gets it directly from the matching ranking entry (no discovery needed).
    let globalPlayerId = ''
    if (provider === 'bat') {
      const idEntry = await readPlayerIdEntry(params.slug)
      globalPlayerId = idEntry?.globalPlayerId ?? ''
    } else if (provider === 'bwf') {
      globalPlayerId = bwfGlobalPlayerId
    }
    if (globalPlayerId) {
      const cached = await readRankingPlayerDetail(provider, globalPlayerId)
      if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
        initialDetail = cached.detail
      }
    }
  }

  return (
    <PlayerProfileView
      record={record}
      playerRankings={playerRankings.length ? playerRankings : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
    />
  )
}

export const dynamic = 'force-dynamic'
