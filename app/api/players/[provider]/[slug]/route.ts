import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(_req: Request, ctx: { params: { provider: string; slug: string } }) {
  const provider = ctx.params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const index = await readIndexCache(provider)
  if (!index) return NextResponse.json({ error: 'index not built' }, { status: 404 })
  const record = index.players[ctx.params.slug]
  if (!record) return NextResponse.json({ error: 'player not found' }, { status: 404 })

  const batRanking: BatRankingPlayerRank[] = []
  if (provider === 'bat') {
    const ranking = await readBatRankingCache()
    if (ranking) {
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === ctx.params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments })
      }
    }
  }

  return NextResponse.json({ record, indexGeneratedAt: index.generatedAt, batRanking })
}
