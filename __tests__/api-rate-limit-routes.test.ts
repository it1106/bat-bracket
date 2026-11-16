// The per-address upstream limit on the scraping routes other than
// /api/matches. A visitor over the limit who asks for something that is not
// cached is turned away before BAT or BWF is asked for anything.
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/bat-player-fetch', () => ({ fetchBatPlayerProfile: jest.fn() }))
jest.mock('../lib/bat-player-cache', () => ({ readBatPlayer: jest.fn(), isFresh: jest.fn() }))
jest.mock('../lib/bwf-player-fetch', () => ({
  fetchBwfPlayerProfile: jest.fn(),
  ScheduleUnavailableError: class extends Error {},
}))
jest.mock('../lib/bat-player-yob', () => ({ getBatPlayerYobs: jest.fn() }))
jest.mock('../lib/bat-yob-switch', () => ({ BAT_YOB_LOOKUP_ENABLED: true }))
jest.mock('../lib/bwf-player-dob-cache', () => ({ getPlayerDobs: jest.fn(), hasUnknownDobs: jest.fn() }))
jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
jest.mock('../lib/bat-player-extra-cache', () => ({ readPlayerExtra: jest.fn(), writePlayerExtra: jest.fn() }))
jest.mock('../lib/bat-player-id-map', () => ({
  readPlayerIdEntry: jest.fn(),
  writePlayerIdSuccess: jest.fn(),
  writePlayerIdFailure: jest.fn(),
  readGlobalPlayerIds: jest.fn(),
}))
jest.mock('../lib/ranking/cache', () => ({ readRankingCache: jest.fn() }))

import { batFetch } from '@/lib/bat-fetch'
import { providerFor } from '@/lib/providers/resolve'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { readBatPlayer, isFresh } from '@/lib/bat-player-cache'
import { getBatPlayerYobs } from '@/lib/bat-player-yob'
import { getPlayerDobs, hasUnknownDobs } from '@/lib/bwf-player-dob-cache'
import { readIndexCache } from '@/lib/player-index-cache'
import { readPlayerExtra } from '@/lib/bat-player-extra-cache'
import { readPlayerIdEntry, writePlayerIdFailure } from '@/lib/bat-player-id-map'
import { readRankingCache } from '@/lib/ranking/cache'
import { allowUpstream, upstreamGate, UPSTREAM_LIMIT, __resetUpstreamLimitForTesting } from '@/lib/rate-limit'
import { GET as events } from '@/app/api/events/route'
import { GET as bracket } from '@/app/api/bracket/route'
import { GET as draws } from '@/app/api/draws/route'
import { GET as groupRefresh } from '@/app/api/group-refresh/route'
import { GET as eventBundle } from '@/app/api/event-bundle/route'
import { GET as overview } from '@/app/api/overview/route'
import { GET as clubs } from '@/app/api/clubs/route'
import { GET as stats } from '@/app/api/stats/route'
import { GET as player } from '@/app/api/player/route'
import { GET as h2h } from '@/app/api/h2h/route'
import { GET as path } from '@/app/api/path/route'
import { GET as profileExtra } from '@/app/api/players/profile-extra/route'
import { GET as rankingDetail } from '@/app/api/players/ranking-detail/route'
import { GET as bwfAges } from '@/app/api/bwf/player-ages/route'
import { GET as batAgesGet, POST as batAgesPost } from '@/app/api/bat/player-ages/route'

const VISITOR = '203.0.113.5'
const from = (address: string) => ({ 'cf-connecting-ip': address })
const q = (params: Record<string, string>) => new URLSearchParams(params).toString()
const get = (path: string, address = VISITOR) => new Request(`http://localhost${path}`, { headers: from(address) })

let n = 0
/** A tournament nobody has asked about, so nothing of it is cached. */
const cold = () => `c01d0000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function exhaust(address: string) {
  for (let i = 0; i < UPSTREAM_LIMIT; i++) allowUpstream(new Request('http://x/', { headers: from(address) }), 'test')
}

let fetchSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  __resetUpstreamLimitForTesting()
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
  ;(readBatPlayer as jest.Mock).mockResolvedValue(null)
  ;(readPlayerExtra as jest.Mock).mockResolvedValue(null)
  ;(readIndexCache as jest.Mock).mockResolvedValue(null)
  ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
  ;(getPlayerDobs as jest.Mock).mockResolvedValue({})
  ;(hasUnknownDobs as jest.Mock).mockResolvedValue(true)
  ;(getBatPlayerYobs as jest.Mock).mockResolvedValue({})
})
afterEach(() => { fetchSpy.mockRestore() })

function expectNothingAsked() {
  expect(batFetch).not.toHaveBeenCalled()
  expect(providerFor).not.toHaveBeenCalled()
  expect(fetchBatPlayerProfile).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
}

type Route = (request: Request) => Promise<Response>
const uncached: Array<[string, Route, () => string]> = [
  ['/api/draws', draws, () => `/api/draws?${q({ id: cold() })}`],
  ['/api/bracket', bracket, () => `/api/bracket?${q({ tournament: cold(), event: '1' })}`],
  ['/api/bracket from a later round', bracket, () => `/api/bracket?${q({ tournament: cold(), event: '1', fromRound: '2' })}`],
  ['/api/events', events, () => `/api/events?${q({ tournament: cold() })}`],
  ['/api/h2h', h2h, () => `/api/h2h?${q({ path: '/head-2-head?T1P1MemberID=1' })}`],
  ['/api/player', player, () => `/api/player?${q({ tournament: cold(), player: '7' })}`],
  ['/api/players/profile-extra', profileExtra, () => `/api/players/profile-extra?${q({ provider: 'bat', slug: 'somchai-saetang' })}`],
  ['/api/overview', overview, () => `/api/overview?${q({ tournament: cold() })}`],
  ['/api/stats', stats, () => `/api/stats?${q({ tournament: cold() })}`],
  ['/api/event-bundle', eventBundle, () => `/api/event-bundle?${q({ tournament: cold(), event: 'BS U15' })}`],
  ['/api/group-refresh', groupRefresh, () => `/api/group-refresh?${q({ tournament: cold(), draw: '1' })}`],
  ['/api/path', path, () => `/api/path?${q({ tournament: cold(), draw: '1', player: '7' })}`],
]

describe('a visitor over the upstream limit, asking for what is not cached', () => {
  it.each(uncached)('%s answers 429 and asks nobody', async (_name, route, url) => {
    exhaust(VISITOR)
    const res = await route(get(url()))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expectNothingAsked()
  })

  it('/api/clubs answers with what it holds — nothing — and asks nobody', async () => {
    exhaust(VISITOR)
    const res = await clubs(get(`/api/clubs?${q({ tournament: cold() })}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expectNothingAsked()
  })

  it('/api/players/ranking-detail answers 429 before its first request to BAT', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue({
      provider: 'bat', scrapedAt: new Date().toISOString(), publishDate: '1/9/2569', rankingId: '53558', events: [],
    })
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { 'somchai-saetang': { sampleRef: { tournamentId: cold(), playerId: '7' } } },
    })
    exhaust(VISITOR)
    const res = await rankingDetail(get(`/api/players/ranking-detail?${q({ provider: 'bat', slug: 'somchai-saetang' })}`))
    expect(res.status).toBe(429)
    expectNothingAsked()
    // Being turned away is not a finding about the player.
    expect(writePlayerIdFailure).not.toHaveBeenCalled()
  })

  // The age lookups answer from their cache for anyone; over the limit they
  // just do not look anybody new up.
  it('/api/bwf/player-ages answers from its cache only', async () => {
    exhaust(VISITOR)
    await bwfAges(get(`/api/bwf/player-ages?${q({ ids: '86870,57971' })}`))
    expect(getPlayerDobs).toHaveBeenCalledWith(['86870', '57971'], { maxLookups: 0 })
  })

  it('/api/bat/player-ages answers from its cache only', async () => {
    const id = cold()
    exhaust(VISITOR)
    await batAgesGet(get(`/api/bat/player-ages?${q({ tournament: id, ids: '1,2' })}`))
    expect(getBatPlayerYobs).toHaveBeenLastCalledWith(id, ['1', '2'], { maxScrapes: 0 })
    await batAgesPost(new Request('http://localhost/api/bat/player-ages', {
      method: 'POST', headers: from(VISITOR), body: JSON.stringify({ tournament: id, ids: ['1', '2'] }),
    }))
    expect(getBatPlayerYobs).toHaveBeenLastCalledWith(id, ['1', '2'], { maxScrapes: 0 })
  })
})

describe('what the limit leaves alone', () => {
  it('a saved player profile is served to a visitor over the limit', async () => {
    ;(readBatPlayer as jest.Mock).mockResolvedValue({ profile: {}, ts: Date.now() })
    ;(isFresh as jest.Mock).mockReturnValue(true)
    ;(fetchBatPlayerProfile as jest.Mock).mockResolvedValue({ profile: { name: 'Somchai' }, source: 'disk' })
    exhaust(VISITOR)
    const res = await player(get(`/api/player?${q({ tournament: cold(), player: '7' })}`))
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('Somchai')
  })

  it('a saved profile-extra is served to a visitor over the limit', async () => {
    ;(readPlayerExtra as jest.Mock).mockResolvedValue({ scrapedAt: new Date().toISOString(), yob: '2008', stats: {} })
    exhaust(VISITOR)
    const res = await profileExtra(get(`/api/players/profile-extra?${q({ provider: 'bat', slug: 'somchai-saetang' })}`))
    expect(res.status).toBe(200)
    expect((await res.json()).yob).toBe('2008')
  })

  it('another visitor is still answered', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, headers: new Headers(), text: async () => '<html></html>' })
    exhaust(VISITOR)
    const res = await h2h(get(`/api/h2h?${q({ path: '/head-2-head?T1P1MemberID=1' })}`, '203.0.113.6'))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(1)
  })

  // Every viewer of a BWF day asks for its players' ages; once they are
  // known, that must not eat into anyone's allowance.
  it('an age request whose players are all known does not count', async () => {
    ;(hasUnknownDobs as jest.Mock).mockResolvedValue(false)
    for (let i = 0; i < UPSTREAM_LIMIT + 10; i++) await bwfAges(get(`/api/bwf/player-ages?${q({ ids: '86870' })}`))
    expect(getPlayerDobs).toHaveBeenLastCalledWith(['86870'])
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, headers: new Headers(), text: async () => '<html></html>' })
    expect((await h2h(get(`/api/h2h?${q({ path: '/head-2-head?T1P1MemberID=1' })}`))).status).toBe(200)
  })

  it('under the limit the age lookups name no cap of their own', async () => {
    await bwfAges(get(`/api/bwf/player-ages?${q({ ids: '86870' })}`))
    expect(getPlayerDobs).toHaveBeenCalledWith(['86870'])
  })
})

describe('upstreamGate', () => {
  it('counts a request once however many times it is asked', () => {
    const gate = upstreamGate(new Request('http://x/', { headers: from(VISITOR) }), 'test')
    for (let i = 0; i < 10; i++) expect(gate()).toBe(true)
    // One of the allowance used, not ten: exactly UPSTREAM_LIMIT - 1 remain.
    for (let i = 0; i < UPSTREAM_LIMIT - 1; i++) expect(allowUpstream(new Request('http://x/', { headers: from(VISITOR) }), 'test')).toBe(true)
    expect(allowUpstream(new Request('http://x/', { headers: from(VISITOR) }), 'test')).toBe(false)
  })

  it('keeps giving the answer it gave first', () => {
    exhaust(VISITOR)
    const gate = upstreamGate(new Request('http://x/', { headers: from(VISITOR) }), 'test')
    expect([gate(), gate()]).toEqual([false, false])
  })

  it('costs nothing when it is never asked', () => {
    upstreamGate(new Request('http://x/', { headers: from(VISITOR) }), 'test')
    for (let i = 0; i < UPSTREAM_LIMIT; i++) expect(allowUpstream(new Request('http://x/', { headers: from(VISITOR) }), 'test')).toBe(true)
  })
})
