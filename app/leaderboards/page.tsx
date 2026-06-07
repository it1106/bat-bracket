import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type {
  Leaderboards, Ranking, RankingEvent, LeaderboardEntry, LeaderboardBoard, ProviderTag,
} from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

// Number of ranking entries we ship to the client per ranking board.
// The client renders the first 10 by default and reveals the rest behind
// a Show more toggle. BAT stops at 30 (long-tail past that); BWF Asia
// Jr. surfaces the full top-100. The cache holds up to 500 per event, of
// which the player profile uses the full depth — this only caps the
// leaderboard board.
const RANKING_BOARD_LIMIT: Record<'bat' | 'bwf', number> = { bat: 30, bwf: 100 }

function rankingEventToBoard(ev: RankingEvent, provider: 'bat' | 'bwf'): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.slice(0, RANKING_BOARD_LIMIT[provider]).map(e => ({
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
    flagUrl: e.countryFlagUrl,
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
  const provider = ranking?.provider === 'bwf' ? 'bwf' : 'bat'
  const rankingBoards = ranking?.events.map(ev => rankingEventToBoard(ev, provider)) ?? []
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

  const rankingIds: Partial<Record<ProviderTag, string>> = {}
  if (batRanking?.rankingId) rankingIds.bat = batRanking.rankingId
  if (bwfRanking?.rankingId) rankingIds.bwf = bwfRanking.rankingId

  return (
    <LeaderboardsView
      leaderboards={providers.length ? providers : [EMPTY]}
      rankingPublishDates={rankingPublishDates}
      rankingIds={rankingIds}
    />
  )
}

export const dynamic = 'force-dynamic'
