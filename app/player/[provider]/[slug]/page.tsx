import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, isDetailScrapeFresh } from '@/lib/ranking/player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import { countContributingTournaments, filterToLowestTwoAgeGroups } from '@/lib/ranking/player-view'
import { rankingSlugAlias } from '@/lib/ranking/aliases'
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
  let rankingCountryFlagUrl = ''
  let bwfGlobalPlayerId = ''
  if (currentRanking) {
    const aliasSlug = rankingSlugAlias(provider, params.slug)
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug || e.slug === aliasSlug)
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
        if (!rankingCountryFlagUrl && entry.countryFlagUrl) rankingCountryFlagUrl = entry.countryFlagUrl
      }
    }
  }

  // 404 only when nothing is known about this slug.
  if (!record && playerRankings.length === 0) notFound()

  // SSR pre-fetch the per-player detail when we know the id and the cache is
  // fresh against the current publishDate AND within the revision TTL (the
  // upstream can revise a published edition in place). BAT gets its id from the
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
    if (
      cached?.detail &&
      cached.detail.publishDate === currentRanking.publishDate &&
      isDetailScrapeFresh(cached.detail.scrapedAt)
    ) {
      initialDetail = cached.detail
    }
  }

  const rankingPublishDate = currentRanking?.publishDate || undefined

  // BWF's category page has no tournaments-played column — every ranking
  // entry's `tournaments` field is 0. When we have the per-player detail
  // cached, recompute the count from the contributing rows so the profile
  // shows the same number BWF prints (the count of distinct deduped
  // contributing tournaments per ranking event, capped at top-10).
  if (provider === 'bwf' && initialDetail) {
    for (const r of playerRankings) {
      const count = countContributingTournaments(initialDetail, r.eventName)
      if (count > 0) r.tournaments = count
    }
  }

  // Players who compete across more than two age tiers (e.g. U17/U19/U23
  // for a strong senior junior) end up with a cluttered Current Ranking
  // section. Show only the two lowest tiers so the section reflects the
  // player's actual competing age band.
  const displayedRankings = filterToLowestTwoAgeGroups(playerRankings)

  if (record) {
    return (
      <PlayerProfileView
        record={record}
        playerRankings={displayedRankings.length ? displayedRankings : undefined}
        rankingPublishDate={rankingPublishDate}
        initialDetail={initialDetail}
        currentRanking={currentRanking}
        countryFlagUrl={rankingCountryFlagUrl || undefined}
      />
    )
  }

  return (
    <MinimalPlayerProfile
      provider={provider}
      slug={params.slug}
      displayName={rankingName}
      country={rankingCountry}
      countryFlagUrl={rankingCountryFlagUrl || undefined}
      playerRankings={displayedRankings}
      rankingPublishDate={rankingPublishDate}
      initialDetail={initialDetail}
      currentRanking={currentRanking}
    />
  )
}

export const dynamic = 'force-dynamic'
