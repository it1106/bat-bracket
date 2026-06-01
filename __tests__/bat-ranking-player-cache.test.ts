import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  readBatRankingPlayerDetail,
  writeBatRankingPlayerDetail,
  writeBatRankingPlayerNotFound,
  __setBatRankingPlayerCacheRootForTesting,
} from '@/lib/bat-ranking-player-cache'
import type { BatRankingPlayerDetail } from '@/lib/types'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-ranking-player-cache-'))
  __setBatRankingPlayerCacheRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

const sample = (publishDate = '26/5/2569'): BatRankingPlayerDetail => ({
  globalPlayerId: '3903158',
  publishDate,
  scrapedAt: '2026-06-01T03:33:12Z',
  tournaments: [{
    tournamentName: 'Test Tournament',
    tournamentId: 'ABCDEF12-0000-0000-0000-000000000000',
    sourceEvent: 'BS U15',
    week: '2026-20',
    result: '5/8',
    points: 3355,
    countsTowardRankings: ["U23 Men's singles"],
  }],
})

describe('bat-ranking-player-cache', () => {
  it('returns null when no file exists', async () => {
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('roundtrips a written detail', async () => {
    const d = sample()
    await writeBatRankingPlayerDetail(d)
    expect(await readBatRankingPlayerDetail('3903158')).toEqual({ version: 1, detail: d })
  })

  it('returns null for a different player', async () => {
    await writeBatRankingPlayerDetail(sample())
    expect(await readBatRankingPlayerDetail('9999999')).toBeNull()
  })

  it('rejects v0 (missing version) envelopes', async () => {
    const file = path.join(tmp, '3903158.json')
    await fs.writeFile(file, JSON.stringify({ detail: sample() }))
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('returns null on corrupt JSON', async () => {
    const file = path.join(tmp, '3903158.json')
    await fs.writeFile(file, '{not json')
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('persists a notFound sentinel without a detail', async () => {
    await writeBatRankingPlayerNotFound('3903158', '26/5/2569')
    const r = await readBatRankingPlayerDetail('3903158')
    expect(r?.detail).toBeUndefined()
    expect(r?.notFound?.publishDate).toBe('26/5/2569')
  })
})
