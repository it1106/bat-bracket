import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import {
  loadCohort, loadU15BackfillSet, cohortReadiness, projectedBoardByEvent,
  PROJECTED_BOARDS, COHORT_SIZE,
} from '@/lib/ranking/u15-cohort'

// Build a ranking with every projected board (all five disciplines of U15 and
// U17). Each board has 60 players; boards share some globalPlayerIds (a player
// appears across disciplines) so the backfill union is smaller than the naive
// sum.
function eventEntries(prefix: string) {
  return Array.from({ length: 60 }, (_, i) => ({
    rank: i + 1, name: `${prefix}P${i}`, slug: `${prefix.toLowerCase()}p${i}`, club: 'C',
    points: 1000 - i, tournaments: 5, globalPlayerId: `${prefix}g${i}`, previousRank: i + 1,
  }))
}

async function seedRanking(dir: string) {
  const events = PROJECTED_BOARDS.map(b => ({
    eventCode: b.eventCode, eventName: b.eventCode, entries: eventEntries(b.eventCode),
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: 'now', publishDate: '23/6/2569', rankingId: '52346',
    series: [{ seriesId: '189', rankingId: '52346', publishDate: '23/6/2569' }], events,
  }))
}

describe('u15-cohort (all projected boards)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cohort-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('maps every board id/discipline/tier', () => {
    expect(PROJECTED_BOARDS).toHaveLength(10)
    expect(PROJECTED_BOARDS.find(b => b.eventCode === 'U15_MD'))
      .toMatchObject({ boardId: 'ranking-u15_md', discipline: 'doubles', ageTier: 15 })
    expect(PROJECTED_BOARDS.find(b => b.eventCode === 'U15_MXD')).toMatchObject({ discipline: 'mixed' })
    expect(PROJECTED_BOARDS.find(b => b.eventCode === 'U17_MD'))
      .toMatchObject({ boardId: 'ranking-u17_md', discipline: 'doubles', ageTier: 17 })
    expect(PROJECTED_BOARDS.find(b => b.eventCode === 'U17_MXD'))
      .toMatchObject({ discipline: 'mixed', ageTier: 17 })
    // Every U15 board has a U17 twin: the tiers are listed, not special-cased.
    expect(PROJECTED_BOARDS.filter(b => b.ageTier === 17)).toHaveLength(5)
  })

  it('resolves every board whose projection is served, and nothing else', () => {
    // The projection is pair-aware, so all ten boards serve.
    // projectedBoardByEvent still filters on `projected`, which is how a board
    // would be withheld again without losing the detail backfill's coverage of
    // its players.
    for (const code of [
      'U15_MS', 'U15_WS', 'U15_MD', 'U15_WD', 'U15_MXD',
      'U17_MS', 'U17_WS', 'U17_MD', 'U17_WD', 'U17_MXD',
    ]) {
      expect(projectedBoardByEvent(code)).toMatchObject({ eventCode: code, projected: true })
    }
    expect(projectedBoardByEvent('NOPE')).toBeUndefined()
  })

  it('loads exactly the top COHORT_SIZE players of a named board', async () => {
    const c = await loadCohort('U15_WS')
    expect(c!.players).toHaveLength(COHORT_SIZE)
    expect(c!.players[0]).toMatchObject({ globalPlayerId: 'U15_WSg0', officialRank: 1 })
  })

  it('backfill set is the de-duped union of all boards top-50', async () => {
    const set = await loadU15BackfillSet()
    // 10 boards x 50, all distinct gids here -> 500 unique.
    expect(set!.gids).toHaveLength(500)
    expect(new Set(set!.gids).size).toBe(500)
    // Both tiers are in the union — the backfill feeds U17 as well as U15.
    expect(set!.gids).toContain('U17_MXDg0')
  })

  it('readiness is false until every union player is present, then true', async () => {
    const before = await cohortReadiness()
    expect(before).toMatchObject({ ready: false, have: 0, total: 500 })

    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569',
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: 500, total: 500 })
  })

  it('keys readiness on publishDate ONLY — a stale-but-current scrape stays ready', async () => {
    // An ancient scrapedAt would fail the 24h freshness TTL; readiness must
    // ignore that and gate on publishDate so the checkbox doesn't flap daily.
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569',
        scrapedAt: '2000-01-01T00:00:00.000Z', tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: 500, total: 500 })
  })

  it('readiness is false when cached details are for a previous publication', async () => {
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '16/6/2569', // last week
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: false, have: 0, total: 500 })
  })
})
