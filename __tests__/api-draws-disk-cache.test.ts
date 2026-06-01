// /api/draws now reads from .cache/draws/<id>.json before contacting BAT,
// so completed tournaments stay serviceable across pm2 reloads even when
// BAT is unreachable. These tests pin that contract: disk hit short-
// circuits before BAT; BAT failure falls back to disk with X-Stale-Cache.
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
// providerFor → getDraws is the upstream batFetch call we want to control,
// but it's reached via lib/draws-cache → fetchDraws → providerFor. Easier
// to mock fetchDraws directly so we don't have to assemble a fake provider.
jest.mock('../lib/draws-cache', () => {
  const actual = jest.requireActual('../lib/draws-cache')
  return { ...actual, fetchDraws: jest.fn() }
})
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'TID', provider: 'bat' })),
  listAllTournaments: jest.fn(() => []),
}))

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { GET } from '@/app/api/draws/route'
import * as drawsCache from '@/lib/draws-cache'

const DRAW = { drawNum: '1', name: 'MS', size: '32', type: 'Elimination' }

let tmpRoot = ''
let tid = 0
const nextId = () => `tid-disk-${++tid}`

const req = (id: string) =>
  new Request(`http://localhost/api/draws?id=${id}`)

describe('GET /api/draws disk cache', () => {
  beforeAll(async () => {
    // The cache lives at process.cwd()/.cache/draws/<id>.json. We can't
    // change cwd mid-test, so write directly under the real cache root and
    // clean up after — same approach as readDayCache tests do indirectly.
    tmpRoot = path.join(process.cwd(), '.cache', 'draws')
    await fs.mkdir(tmpRoot, { recursive: true })
  })

  beforeEach(() => {
    ;(drawsCache.fetchDraws as jest.Mock).mockReset()
    // Wipe the in-memory cache so each test starts clean — otherwise the
    // disk hit can be masked by a leftover mem entry from a sibling test.
    drawsCache.cache.clear()
  })

  it('hydrates from disk when mem is empty and BAT is never called', async () => {
    const id = nextId()
    const diskFile = path.join(tmpRoot, `${id.toLowerCase()}.json`)
    await fs.writeFile(diskFile, JSON.stringify({ draws: [DRAW], done: true, ts: Date.now() }), 'utf8')

    const res = await GET(req(id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([DRAW])
    expect(drawsCache.fetchDraws).not.toHaveBeenCalled()
    await fs.unlink(diskFile).catch(() => {})
  })

  it('falls back to disk on BAT failure when mem is empty (with X-Stale-Cache)', async () => {
    const id = nextId()
    // Disk entry is past the 30-min TTL and not done, so the route falls
    // through the first cached.done|inTtl check and actually tries BAT.
    const diskFile = path.join(tmpRoot, `${id.toLowerCase()}.json`)
    await fs.writeFile(
      diskFile,
      JSON.stringify({ draws: [DRAW], ts: Date.now() - 60 * 60_000 }),
      'utf8',
    )
    ;(drawsCache.fetchDraws as jest.Mock).mockRejectedValueOnce(new Error('ETIMEDOUT'))

    const res = await GET(req(id))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
    const body = await res.json()
    expect(body).toEqual([DRAW])
    await fs.unlink(diskFile).catch(() => {})
  })

  it('returns 500 when BAT fails and neither mem nor disk has a copy', async () => {
    const id = nextId()
    ;(drawsCache.fetchDraws as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await GET(req(id))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Could not load draws/)
  })

  afterAll(async () => {
    // No global tmpRoot teardown — other tests / dev cache live here.
    // Per-test files are cleaned individually above.
    // os import keeps the bundler honest about node deps.
    void os
    void tmpRoot
  })
})
