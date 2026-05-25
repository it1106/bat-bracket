import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  const batRanking: BatRankingPlayerRank[] = []
  if (provider === 'bat') {
    const ranking = await readBatRankingCache()
    if (ranking) {
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments })
      }
    }
  }

  return <PlayerProfileView record={record} batRanking={batRanking.length ? batRanking : undefined} />
}

export const dynamic = 'force-dynamic'
