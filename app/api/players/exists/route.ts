import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { nameToSlug } from '@/lib/playerIndex'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const name = u.searchParams.get('name')
  if (!provider || !name || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provider and name required' }, { status: 400 })
  }
  const slug = nameToSlug(name)
  const index = await readIndexCache(provider)
  const exists = !!index?.players[slug]

  let batRanking: BatRankingPlayerRank[] | undefined
  if (provider === 'bat' && exists) {
    const ranking = await readBatRankingCache()
    if (ranking) {
      const found: BatRankingPlayerRank[] = []
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === slug)
        if (entry) found.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points })
      }
      if (found.length) batRanking = found
    }
  }

  return NextResponse.json({ exists, slug, ...(batRanking ? { batRanking } : {}) })
}
