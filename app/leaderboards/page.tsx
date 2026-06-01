import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards, BatRankingEvent, LeaderboardEntry, LeaderboardBoard } from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

// Number of ranking entries we ship to the client per BAT ranking board.
// The client renders the first 10 by default and reveals the rest behind a
// 'Show top 30' toggle. The BAT cache holds up to 50 per event, but past 30
// the names get long-tail enough that ~all users won't look — capping at 30
// keeps the initial payload from ballooning while still giving plenty of
// room to scan for any player who hovers around the bubble.
const RANKING_BOARD_LIMIT = 30

function rankingEventToBoard(ev: BatRankingEvent): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.slice(0, RANKING_BOARD_LIMIT).map(e => ({
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
