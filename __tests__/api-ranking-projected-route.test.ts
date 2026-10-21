import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import { __setRankingPlayerCacheRootForTesting } from '@/lib/ranking/player-cache'
import { GET } from '@/app/api/ranking/projected/route'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: 'now', publishDate: '23/6/2569', rankingId: '52346',
    series: [{ seriesId: '189', rankingId: '52346', publishDate: '23/6/2569' }],
    events: [
      { eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries },
      { eventCode: 'U17_MS', eventName: 'U17 Boys singles', entries: entries.map(e => ({ ...e, globalPlayerId: `u17${e.globalPlayerId}` })) },
    ],
  }))
}

describe('GET /api/ranking/projected', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('returns ready:false with progress when details are missing', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat'))
    const body = await res.json()
    // Union of the two seeded boards' top-50 (distinct players) — readiness is
    // one combined gate across U15 and U17.
    expect(body).toMatchObject({ ready: false, have: 0, total: 100 })
  })

  it('rejects non-bat providers', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bwf'))
    expect(res.status).toBe(400)
  })

  it('rejects an unknown board event', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat&event=U15_XX'))
    expect(res.status).toBe(400)
  })

  it('accepts a served board event', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat&event=U15_WS'))
    const body = await res.json()
    // Not ready (no details seeded) but the event is accepted, not a 400.
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ready: false })
  })

  it.each([
    'U15_MD', 'U15_WD', 'U15_MXD',
    'U17_MS', 'U17_WS', 'U17_MD', 'U17_WD', 'U17_MXD',
  ])('serves %s', async (event) => {
    const res = await GET(new Request(`http://x/api/ranking/projected?provider=bat&event=${event}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ready: false })
  })

  it('still refuses an event that is not a projected board', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat&event=U15_NOPE'))
    expect(res.status).toBe(400)
  })
})
