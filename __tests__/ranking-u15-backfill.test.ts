import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import {
  runU15Backfill, selfHealU15Backfill, __resetSelfHealStateForTesting,
} from '@/lib/ranking/u15-backfill'
import type { RankingPlayerDetail } from '@/lib/types'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: 'now', publishDate: '30/6/2569', rankingId: '52400',
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
  }))
}

const detail = (gid: string, publishDate: string): RankingPlayerDetail => ({
  globalPlayerId: gid, publishDate, scrapedAt: new Date().toISOString(), tournaments: [],
})

describe('runU15Backfill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'u15bf-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('returns an error when no ranking is cached', async () => {
    await fs.rm(path.join(dir, 'ranking-bat.json'))
    const res = await runU15Backfill({ delayMs: 0 })
    expect(res).toMatchObject({ error: expect.any(String) })
  })

  it('fetches the cohort details against the current publishDate, skipping fresh ones', async () => {
    // Pre-seed g0 as already fresh for the current publication.
    await writeRankingPlayerDetail('bat', detail('g0', '30/6/2569'))
    const fetched: string[] = []
    const res = await runU15Backfill({
      delayMs: 0, jitterMs: 0,
      fetchDetail: async (gid, _rankingId, publishDate) => { fetched.push(gid); return detail(gid, publishDate) },
    })
    expect(res).toMatchObject({ total: 50, have: 1, fetched: 49, failed: [] })
    expect(fetched).not.toContain('g0')
    expect(fetched).toContain('g49')
  })

  it('passes the cohort rankingId + publishDate through to the fetcher', async () => {
    let seen: { rankingId: string; publishDate: string } | null = null
    await runU15Backfill({
      delayMs: 0, jitterMs: 0,
      fetchDetail: async (gid, rankingId, publishDate) => { seen = { rankingId, publishDate }; return detail(gid, publishDate) },
    })
    expect(seen).toEqual({ rankingId: '52400', publishDate: '30/6/2569' })
  })
})

describe('selfHealU15Backfill', () => {
  let dir: string
  beforeEach(async () => {
    __resetSelfHealStateForTesting()
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'u15heal-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('skips without fetching when the cohort is already complete', async () => {
    const fetched: string[] = []
    const res = await selfHealU15Backfill({
      delayMs: 0, jitterMs: 0,
      readiness: async () => ({ ready: true, have: 50, total: 50 }),
      fetchDetail: async (gid, _r, pub) => { fetched.push(gid); return detail(gid, pub) },
    })
    expect(res).toEqual({ skipped: 'ready' })
    expect(fetched).toEqual([])
  })

  it('runs the backfill when the cohort is incomplete', async () => {
    const fetched: string[] = []
    const res = await selfHealU15Backfill({
      delayMs: 0, jitterMs: 0,
      readiness: async () => ({ ready: false, have: 0, total: 50 }),
      fetchDetail: async (gid, _r, pub) => { fetched.push(gid); return detail(gid, pub) },
    })
    expect(res).toMatchObject({ total: 50, fetched: 50, failed: [] })
    expect(fetched).toContain('g0')
  })

  it('backs off after an incomplete run instead of re-sweeping every tick', async () => {
    const opts = {
      delayMs: 0, jitterMs: 0,
      readiness: async () => ({ ready: false, have: 49, total: 50 }),
      // g0 always fails (a 500/timeout never becomes notFound) -> run stays incomplete
      fetchDetail: async (gid: string, _r: string, pub: string) => {
        if (gid === 'g0') throw new Error('upstream 500')
        return detail(gid, pub)
      },
    }
    const first = await selfHealU15Backfill({ ...opts, now: 1_000 })
    expect(first).toMatchObject({ failed: ['g0'] })
    // A second attempt inside the back-off window must NOT re-sweep.
    const second = await selfHealU15Backfill({ ...opts, now: 2_000 })
    expect(second).toMatchObject({ skipped: 'backoff' })
  })

  it('bypasses the back-off when a new publication arrives (weekly sweep always runs)', async () => {
    const failG0 = async (gid: string, _r: string, pub: string) => {
      if (gid === 'g0') throw new Error('upstream 500')
      return detail(gid, pub)
    }
    const readiness = async () => ({ ready: false, have: 49, total: 50 })
    await selfHealU15Backfill({ delayMs: 0, jitterMs: 0, readiness, fetchDetail: failG0, now: 1_000 })

    // New publication: bump the cached ranking's publishDate.
    const ranking = JSON.parse(await fs.readFile(path.join(dir, 'ranking-bat.json'), 'utf8'))
    ranking.publishDate = '7/7/2569'
    await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify(ranking))

    let attempted = false
    const res = await selfHealU15Backfill({
      delayMs: 0, jitterMs: 0, readiness, now: 1_500, // still inside the 6h back-off window
      fetchDetail: async (gid, _r, pub) => { attempted = true; return detail(gid, pub) },
    })
    expect(attempted).toBe(true)
    expect(res).not.toMatchObject({ skipped: 'backoff' })
  })
})
