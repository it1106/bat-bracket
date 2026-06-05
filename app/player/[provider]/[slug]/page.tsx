import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import MinimalPlayerProfile from '@/components/MinimalPlayerProfile'
import type { ProviderTag, RankingPlayerRank, RankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()

  // Read both caches in parallel — the minimal-profile branch needs the
  // ranking cache even when the index lookup misses.
  const [index, currentRanking] = await Promise.all([
    readIndexCache(provider),
    readRankingCache(provider),
  ])
  const record = index?.players[params.slug]

  // Collect this slug's ranking entries regardless of index hit.
  const playerRankings: RankingPlayerRank[] = []
  let rankingName = ''
  let rankingCountry = ''
  let bwfGlobalPlayerId = ''
  if (currentRanking) {
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug)
      if (entry) {
        playerRankings.push({
          eventName: ev.eventName,
          rank: entry.rank,
          points: entry.points,
          tournaments: entry.tournaments,
        })
        if (entry.globalPlayerId) bwfGlobalPlayerId = entry.globalPlayerId
        if (!rankingName) rankingName = entry.name
        if (!rankingCountry) rankingCountry = entry.club
      }
    }
  }

  // 404 only when nothing is known about this slug.
  if (!record && playerRankings.length === 0) notFound()

  // SSR pre-fetch the per-player detail when we know the id and the cache
  // is fresh against the current publishDate. BAT gets its id from the
  // slug↔id map (built by the 3-hop discovery on first request); BWF gets
  // it directly from the matching ranking entry (no discovery needed).
  let initialDetail: RankingPlayerDetail | undefined
  let globalPlayerId = ''
  if (provider === 'bat') {
    const idEntry = await readPlayerIdEntry(params.slug)
    globalPlayerId = idEntry?.globalPlayerId ?? ''
  } else if (provider === 'bwf') {
    globalPlayerId = bwfGlobalPlayerId
  }
  if (globalPlayerId && currentRanking) {
    const cached = await readRankingPlayerDetail(provider, globalPlayerId)
    if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
      initialDetail = cached.detail
    }
  }

  const rankingPublishDate = currentRanking?.publishDate || undefined

  if (record) {
    return (
      <PlayerProfileView
        record={record}
        playerRankings={playerRankings.length ? playerRankings : undefined}
        rankingPublishDate={rankingPublishDate}
        initialDetail={initialDetail}
        currentRanking={currentRanking}
      />
    )
  }

  return (
    <MinimalPlayerProfile
      provider={provider}
      slug={params.slug}
      displayName={rankingName}
      country={rankingCountry}
      playerRankings={playerRankings}
      rankingPublishDate={rankingPublishDate}
      initialDetail={initialDetail}
      currentRanking={currentRanking}
    />
  )
}

export const dynamic = 'force-dynamic'
