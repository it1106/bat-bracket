import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards, BatRankingEvent, LeaderboardEntry, LeaderboardBoard } from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

function rankingEventToBoard(ev: BatRankingEvent): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.slice(0, 10).map(e => ({
    rank: e.rank,
    slug: e.slug,
    name: e.name,
    primaryClub: e.club,
    value: e.points,
    display: e.points.toLocaleString() + ' pts',
    extra: `${e.tournaments} tn`,
  }))
  return {
    id: `ranking-${ev.eventCode.toLowerCase()}`,
    titleKey: ev.eventName,
    icon: '🏸',
    category: 'ranking',
    entries,
  }
}

export default async function LeaderboardsPage() {
  const [bat, bwf, ranking] = await Promise.all([
    readLeaderboardsCache('bat'),
    readLeaderboardsCache('bwf'),
    readBatRankingCache(),
  ])

  const providers: Leaderboards[] = []

  if (bat) {
    const rankingBoards: LeaderboardBoard[] = ranking?.events.map(rankingEventToBoard) ?? []
    providers.push({ ...bat, boards: [...bat.boards, ...rankingBoards] })
  }

  if (bwf) providers.push(bwf)

  return (
    <LeaderboardsView
      leaderboards={providers.length ? providers : [EMPTY]}
      rankingPublishDate={ranking?.publishDate || undefined}
    />
  )
}

export const dynamic = 'force-dynamic'
