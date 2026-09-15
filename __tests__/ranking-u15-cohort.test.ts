import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import {
  loadCohort, loadU15BackfillSet, cohortReadiness, u15BoardByEvent,
  U15_BOARDS, COHORT_SIZE,
} from '@/lib/ranking/u15-cohort'

// Build a ranking with all five U15 boards. Each board has 60 players; boards
// share some globalPlayerIds (a player appears across disciplines) so the
// backfill union is smaller than the naive sum.
function eventEntries(prefix: string) {
  return Array.from({ length: 60 }, (_, i) => ({
    rank: i + 1, name: `${prefix}P${i}`, slug: `${prefix.toLowerCase()}p${i}`, club: 'C',
    points: 1000 - i, tournaments: 5, globalPlayerId: `${prefix}g${i}`, previousRank: i + 1,
  }))
}

const RANKING_SCRAPED_AT = '2026-06-23T10:00:00.000Z'

async function seedRanking(dir: string) {
  const events = U15_BOARDS.map(b => ({
    eventCode: b.eventCode, eventName: b.eventCode, entries: eventEntries(b.eventCode),
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: RANKING_SCRAPED_AT, publishDate: '23/6/2569', rankingId: '52346',
    series: [{ seriesId: '189', rankingId: '52346', publishDate: '23/6/2569' }], events,
  }))
}

describe('u15-cohort (all U15 boards)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cohort-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('maps every board id/discipline', () => {
    expect(U15_BOARDS).toHaveLength(5)
    expect(U15_BOARDS.find(b => b.eventCode === 'U15_MD'))
      .toMatchObject({ boardId: 'ranking-u15_md', discipline: 'doubles' })
    expect(U15_BOARDS.find(b => b.eventCode === 'U15_MXD')).toMatchObject({ discipline: 'mixed' })
  })

  it('resolves every board whose projection is served, and nothing else', () => {
    // The projection is pair-aware, so all five boards serve. u15BoardByEvent
    // still filters on `projected`, which is how a board would be withheld
    // again without losing the detail backfill's coverage of its players.
    for (const code of ['U15_MS', 'U15_WS', 'U15_MD', 'U15_WD', 'U15_MXD']) {
      expect(u15BoardByEvent(code)).toMatchObject({ eventCode: code, projected: true })
    }
    expect(u15BoardByEvent('NOPE')).toBeUndefined()
  })

  it('loads exactly the top COHORT_SIZE players of a named board', async () => {
    const c = await loadCohort('U15_WS')
    expect(c!.players).toHaveLength(COHORT_SIZE)
    expect(c!.players[0]).toMatchObject({ globalPlayerId: 'U15_WSg0', officialRank: 1 })
  })

  it('backfill set is the de-duped union of all boards top-50', async () => {
    const set = await loadU15BackfillSet()
    // 5 boards x 50, all distinct gids here -> 250 unique.
    expect(set!.gids).toHaveLength(250)
    expect(new Set(set!.gids).size).toBe(250)
  })

  it('readiness is false until every union player is present, then true', async () => {
    const before = await cohortReadiness()
    expect(before).toMatchObject({ ready: false, have: 0, total: 250 })

    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569',
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: 250, total: 250 })
  })

  it('ignores the 24h freshness TTL — a days-old scrape of the current snapshot stays ready', async () => {
    // The TTL that gates on-demand player pages must not gate the cohort, or
    // the checkbox flaps off the day after each weekly sweep. Any detail taken
    // after the ranking snapshot counts, however long ago.
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569',
        scrapedAt: '2026-06-28T10:00:00.000Z', // 5 days after the snapshot
        tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: 250, total: 250 })
  })

  it('is not ready when the detail predates the ranking snapshot it is read against', async () => {
    // An in-place revision keeps publishDate but moves the ranking's scrapedAt.
    // This is how รวิณ ชูชัยศรี's profile came to list nine U15 singles
    // tournaments under a header reading "10 tn · 38,437 pts": BAT added the
    // Ponsana row hours after we cached his detail, and publishDate-only
    // readiness could not see it.
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569',
        scrapedAt: '2026-06-23T09:00:00.000Z', // an hour BEFORE the snapshot
        tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: false, have: 0, total: 250 })
  })

  it('falls back to publishDate-only when a timestamp is unusable', async () => {
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '23/6/2569', scrapedAt: 'not-a-date', tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: 250, total: 250 })
  })

  it('readiness is false when cached details are for a previous publication', async () => {
    const set = await loadU15BackfillSet()
    for (const gid of set!.gids) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: gid, publishDate: '16/6/2569', // last week
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: false, have: 0, total: 250 })
  })
})
