import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { readBatRankingPlayerDetail } from '@/lib/bat-ranking-player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, BatRankingPlayerRank, BatRankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  const batRanking: BatRankingPlayerRank[] = []
  let rankingPublishDate = ''
  let currentRanking: Awaited<ReturnType<typeof readBatRankingCache>> = null
  let initialDetail: BatRankingPlayerDetail | undefined

  if (provider === 'bat') {
    currentRanking = await readBatRankingCache()
    if (currentRanking) {
      rankingPublishDate = currentRanking.publishDate
      for (const ev of currentRanking.events) {
        const entry = ev.entries.find(e => e.slug === params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments })
      }
      // SSR pre-fetch the per-player detail if we have the global id
      // mapped and the cache is fresh against the current publishDate.
      const idEntry = await readPlayerIdEntry(params.slug)
      if (idEntry && idEntry.globalPlayerId) {
        const cached = await readBatRankingPlayerDetail(idEntry.globalPlayerId)
        if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
          initialDetail = cached.detail
        }
      }
    }
  }

  return (
    <PlayerProfileView
      record={record}
      batRanking={batRanking.length ? batRanking : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
      currentRanking={currentRanking ?? undefined}
    />
  )
}

export const dynamic = 'force-dynamic'
