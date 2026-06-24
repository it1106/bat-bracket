import { runDetailBackfill, BackfillBusyError } from '@/lib/ranking/detail-backfill'
import type { RankingPlayerDetail } from '@/lib/types'

const detail = (gid: string): RankingPlayerDetail => ({
  globalPlayerId: gid, publishDate: 'P', scrapedAt: 'now', tournaments: [],
})
const noSleep = () => Promise.resolve()

describe('runDetailBackfill', () => {
  it('skips players already ready and fetches only the gaps', async () => {
    const ready = new Set(['a'])
    const fetched: string[] = []
    const res = await runDetailBackfill(['a', 'b', 'c'], {
      isReady: async g => ready.has(g),
      fetchDetail: async g => { fetched.push(g); return detail(g) },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    expect(fetched).toEqual(['b', 'c'])
    expect(res).toMatchObject({ total: 3, fetched: 2 })
  })

  it('persists notFound and counts it as fetched, not failed', async () => {
    const nf: string[] = []
    const res = await runDetailBackfill(['x'], {
      isReady: async () => false,
      fetchDetail: async () => ({ notFound: true }),
      persistNotFound: async g => { nf.push(g) },
      sleep: noSleep, delayMs: 0,
    })
    expect(nf).toEqual(['x'])
    expect(res.failed).toEqual([])
  })

  it('collects per-player failures without aborting the run', async () => {
    const res = await runDetailBackfill(['a', 'b'], {
      isReady: async () => false,
      fetchDetail: async g => { if (g === 'a') throw new Error('boom'); return detail(g) },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    expect(res.failed).toEqual(['a'])
    expect(res.fetched).toBe(1)
  })

  it('trips the circuit breaker after consecutive failures', async () => {
    const attempted: string[] = []
    const res = await runDetailBackfill(['a', 'b', 'c', 'd'], {
      isReady: async () => false,
      fetchDetail: async g => { attempted.push(g); throw new Error('429') },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0, breakerThreshold: 2,
    })
    expect(attempted).toEqual(['a', 'b']) // stops after 2 consecutive failures
    expect(res.failed).toEqual(['a', 'b'])
  })

  it('rejects re-entry while a run is in flight (single-flight)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const first = runDetailBackfill(['a'], {
      isReady: async () => false,
      fetchDetail: async () => { await gate; return detail('a') },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    await expect(
      runDetailBackfill(['b'], {
        isReady: async () => false, fetchDetail: async () => detail('b'),
        persistNotFound: async () => {}, sleep: noSleep, delayMs: 0,
      }),
    ).rejects.toBeInstanceOf(BackfillBusyError)
    release()
    await first
  })
})
