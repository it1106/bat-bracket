import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import { loadCohort, cohortReadiness, COHORT_SIZE } from '@/lib/ranking/u15-cohort'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 60 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  const ranking = {
    provider: 'bat', scrapedAt: 'now', publishDate: '23/6/2569', rankingId: '52346',
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
  }
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify(ranking))
}

describe('u15-cohort', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cohort-'))
    __setRankingCacheRootForTesting(dir)                       // ranking-bat.json lives here
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('loads exactly the top COHORT_SIZE players by rank', async () => {
    const c = await loadCohort()
    expect(c).not.toBeNull()
    expect(c!.players).toHaveLength(COHORT_SIZE)
    expect(c!.players[0]).toMatchObject({ slug: 'p0', globalPlayerId: 'g0', officialRank: 1 })
    expect(c!.publishDate).toBe('23/6/2569')
  })

  it('readiness is false until all cohort details are fresh for the publishDate', async () => {
    expect(await cohortReadiness()).toMatchObject({ ready: false, have: 0, total: COHORT_SIZE })
    for (let i = 0; i < COHORT_SIZE; i++) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: `g${i}`, publishDate: '23/6/2569',
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: COHORT_SIZE })
  })

  it('a detail from a different publishDate does not count as ready', async () => {
    await writeRankingPlayerDetail('bat', {
      globalPlayerId: 'g0', publishDate: '16/6/2569',
      scrapedAt: new Date().toISOString(), tournaments: [],
    })
    expect((await cohortReadiness()).have).toBe(0)
  })
})
