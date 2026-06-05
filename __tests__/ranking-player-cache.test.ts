import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readRankingPlayerDetail,
  writeRankingPlayerDetail,
  writeRankingPlayerNotFound,
  __setRankingPlayerCacheRootForTesting,
} from '@/lib/ranking/player-cache'

describe('ranking player cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-'))
    __setRankingPlayerCacheRootForTesting(dir)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('returns null on miss', async () => {
    expect(await readRankingPlayerDetail('bwf', '12345')).toBeNull()
  })

  it('round-trips a detail per provider', async () => {
    await writeRankingPlayerDetail('bwf', {
      globalPlayerId: '12345', publishDate: '03/06/2026', scrapedAt: 'now', tournaments: [],
    })
    const out = await readRankingPlayerDetail('bwf', '12345')
    expect(out?.detail?.globalPlayerId).toBe('12345')
  })

  it('writes a notFound stub', async () => {
    await writeRankingPlayerNotFound('bwf', '99', '03/06/2026')
    const out = await readRankingPlayerDetail('bwf', '99')
    expect(out?.notFound?.publishDate).toBe('03/06/2026')
  })

  it('stores BAT and BWF in separate sub-directories', async () => {
    await writeRankingPlayerDetail('bat', {
      globalPlayerId: '7', publishDate: '03/6/2569', scrapedAt: 'now', tournaments: [],
    })
    await writeRankingPlayerDetail('bwf', {
      globalPlayerId: '7', publishDate: '03/06/2026', scrapedAt: 'now', tournaments: [],
    })
    const bat = await readRankingPlayerDetail('bat', '7')
    const bwf = await readRankingPlayerDetail('bwf', '7')
    expect(bat?.detail?.publishDate).toBe('03/6/2569')
    expect(bwf?.detail?.publishDate).toBe('03/06/2026')
  })
})
