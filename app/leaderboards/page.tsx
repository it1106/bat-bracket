import { readLeaderboardsCache } from '@/lib/player-index-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards } from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

export default async function LeaderboardsPage() {
  const [bat, bwf] = await Promise.all([
    readLeaderboardsCache('bat'),
    readLeaderboardsCache('bwf'),
  ])
  const providers: Leaderboards[] = [bat, bwf].filter(Boolean) as Leaderboards[]
  return <LeaderboardsView leaderboards={providers.length ? providers : [EMPTY]} />
}

export const dynamic = 'force-dynamic'
