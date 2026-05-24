import { NextResponse } from 'next/server'
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import type { ProviderTag, LeaderboardCategory } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])
const CATEGORIES = new Set<LeaderboardCategory>(['headline', 'discipline', 'character', 'activity'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = (u.searchParams.get('provider') || 'bat') as ProviderTag
  const category = u.searchParams.get('category') as LeaderboardCategory | null
  if (!PROVIDERS.has(provider)) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  const lb = await readLeaderboardsCache(provider)
  if (!lb) return NextResponse.json({ error: 'not built' }, { status: 404 })
  let boards = lb.boards
  if (category) {
    if (!CATEGORIES.has(category)) return NextResponse.json({ error: 'unknown category' }, { status: 400 })
    boards = boards.filter(b => b.category === category)
  }
  return NextResponse.json({ boards, generatedAt: lb.generatedAt })
}
