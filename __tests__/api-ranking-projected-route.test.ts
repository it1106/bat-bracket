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
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
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
    expect(body).toMatchObject({ ready: false, have: 0, total: 50 })
  })

  it('rejects non-bat providers', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bwf'))
    expect(res.status).toBe(400)
  })

  it('rejects an unknown U15 board event', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat&event=U15_XX'))
    expect(res.status).toBe(400)
  })

  it('accepts a valid U15 board event (e.g. doubles)', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat&event=U15_MD'))
    const body = await res.json()
    // Not ready (no details seeded) but the event is accepted, not a 400.
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ready: false })
  })
})
