import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type {
  Leaderboards, Ranking, RankingEvent, LeaderboardEntry, LeaderboardBoard, ProviderTag,
} from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

// Number of ranking entries we ship to the client per ranking board.
// The client renders the first 10 by default and reveals the rest behind
// a 'Show top 30' toggle. The upstream cache holds up to 50 per event,
// but past 30 the names get long-tail enough that ~all users won't look.
const RANKING_BOARD_LIMIT = 30

function rankingEventToBoard(ev: RankingEvent): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.slice(0, RANKING_BOARD_LIMIT).map(e => ({
    rank: e.rank,
    slug: e.slug,
    name: e.name,
    primaryClub: e.club,
    value: e.points,
    display: e.points.toLocaleString() + ' pts',
    // BWF rows have no tournaments-played column on the upstream page, so
    // the value is 0 there. Hide the badge when there's no data; BAT rows
    // (which carry an actual count) keep showing it.
    extra: e.tournaments > 0 ? `${e.tournaments} tn` : undefined,
  }))
  return {
    id: `ranking-${ev.eventCode.toLowerCase()}`,
    titleKey: ev.eventName,
    icon: '🏸',
    category: 'ranking',
    entries,
  }
}

function attachRanking(base: Leaderboards | null, ranking: Ranking | null): Leaderboards | null {
  if (!base) return null
  const rankingBoards = ranking?.events.map(rankingEventToBoard) ?? []
  return { ...base, boards: [...base.boards, ...rankingBoards] }
}

export default async function LeaderboardsPage() {
  const [bat, bwf, batRanking, bwfRanking] = await Promise.all([
    readLeaderboardsCache('bat'),
    readLeaderboardsCache('bwf'),
    readRankingCache('bat'),
    readRankingCache('bwf'),
  ])

  const providers: Leaderboards[] = []
  const withBat = attachRanking(bat, batRanking)
  if (withBat) providers.push(withBat)
  const withBwf = attachRanking(bwf, bwfRanking)
  if (withBwf) providers.push(withBwf)

  const rankingPublishDates: Partial<Record<ProviderTag, string>> = {}
  if (batRanking?.publishDate) rankingPublishDates.bat = batRanking.publishDate
  if (bwfRanking?.publishDate) rankingPublishDates.bwf = bwfRanking.publishDate

  return (
    <LeaderboardsView
      leaderboards={providers.length ? providers : [EMPTY]}
      rankingPublishDates={rankingPublishDates}
    />
  )
}

export const dynamic = 'force-dynamic'
