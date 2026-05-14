jest.mock('../lib/event-bundle-cache', () => {
  const real = jest.requireActual('../lib/event-bundle-cache')
  return {
    ...real,
    cache: new Map(),
    fetchAndCache: jest.fn(),
  }
})

import { GET } from '../app/api/event-bundle/route'
import { fetchAndCache, cache } from '../lib/event-bundle-cache'

const makeReq = (params: Record<string, string>) => new Request(
  'http://localhost/api/event-bundle?' + new URLSearchParams(params).toString()
)

describe('GET /api/event-bundle', () => {
  beforeEach(() => {
    cache.clear()
    ;(fetchAndCache as jest.Mock).mockReset()
  })

  it('400 if missing params', async () => {
    const res = await GET(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('404 when bundle is null', async () => {
    ;(fetchAndCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(404)
  })

  it('200 returns the bundle', async () => {
    const fake = { eventName: 'BS U11', playoff: { html: '', format: 'single-elimination' }, playoffDrawNum: '9', groups: [] }
    ;(fetchAndCache as jest.Mock).mockResolvedValue(fake)
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fake)
  })

  it('serves cached bundle without re-fetching', async () => {
    const fake = { eventName: 'BS U11', playoff: { html: '', format: 'single-elimination' }, playoffDrawNum: '9', groups: [] }
    cache.set('guid::BS U11', { bundle: fake as never, ts: Date.now() })
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(200)
    expect(fetchAndCache).not.toHaveBeenCalled()
  })
})
