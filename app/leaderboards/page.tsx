import { readLeaderboardsCache } from '@/lib/player-index-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards } from '@/lib/types'

export default async function LeaderboardsPage() {
  const bat = await readLeaderboardsCache('bat')
  const bwf = await readLeaderboardsCache('bwf')
  const lb: Leaderboards = bat ?? bwf ?? {
    version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [],
  }
  return <LeaderboardsView leaderboards={lb} />
}

export const dynamic = 'force-dynamic'
