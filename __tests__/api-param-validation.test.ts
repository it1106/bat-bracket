// Every scraping route puts the visitor's tournament, date and draw into an
// address it asks BAT or BWF for. A value that is not the real thing's shape
// must be turned away before anything is asked of anyone.
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/bat-player-fetch', () => ({ fetchBatPlayerProfile: jest.fn() }))
jest.mock('../lib/bwf-player-fetch', () => ({
  fetchBwfPlayerProfile: jest.fn(),
  ScheduleUnavailableError: class extends Error {},
}))
jest.mock('../lib/bat-player-yob', () => ({ getBatPlayerYobs: jest.fn() }))
jest.mock('../lib/bat-yob-switch', () => ({ BAT_YOB_LOOKUP_ENABLED: true }))

import { batFetch } from '@/lib/bat-fetch'
import { providerFor } from '@/lib/providers/resolve'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { fetchBwfPlayerProfile } from '@/lib/bwf-player-fetch'
import { getBatPlayerYobs } from '@/lib/bat-player-yob'
import { GET as matches } from '@/app/api/matches/route'
import { GET as events } from '@/app/api/events/route'
import { GET as bracket } from '@/app/api/bracket/route'
import { GET as draws } from '@/app/api/draws/route'
import { GET as groupRefresh } from '@/app/api/group-refresh/route'
import { GET as eventBundle } from '@/app/api/event-bundle/route'
import { GET as overview } from '@/app/api/overview/route'
import { GET as clubs } from '@/app/api/clubs/route'
import { GET as stats } from '@/app/api/stats/route'
import { GET as player } from '@/app/api/player/route'
import { GET as batAgesGet, POST as batAgesPost } from '@/app/api/bat/player-ages/route'

const GOOD = 'A97008D7-AA53-44AA-9BB7-2A6A2734EA47'
const BAD_IDS = ['abc123', '../../sport/admin', `${GOOD}/../../sport`, `${GOOD}%0d%0a`, 'x'.repeat(300)]

const get = (path: string) => new Request(`http://localhost${path}`)
const q = (params: Record<string, string>) => new URLSearchParams(params).toString()

let fetchSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
})
afterEach(() => { fetchSpy.mockRestore() })

function expectNothingAsked() {
  expect(batFetch).not.toHaveBeenCalled()
  expect(providerFor).not.toHaveBeenCalled()
  expect(fetchBatPlayerProfile).not.toHaveBeenCalled()
  expect(fetchBwfPlayerProfile).not.toHaveBeenCalled()
  expect(getBatPlayerYobs).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
}

type Route = (request: Request) => Promise<Response>
const byTournament: Array<[string, Route, (id: string) => string]> = [
  ['/api/matches', matches, (id) => `/api/matches?${q({ tournament: id })}`],
  ['/api/matches (one day)', matches, (id) => `/api/matches?${q({ tournament: id, date: '25691102' })}`],
  ['/api/events', events, (id) => `/api/events?${q({ tournament: id })}`],
  ['/api/bracket', bracket, (id) => `/api/bracket?${q({ tournament: id, event: '1' })}`],
  ['/api/draws', draws, (id) => `/api/draws?${q({ id })}`],
  ['/api/group-refresh', groupRefresh, (id) => `/api/group-refresh?${q({ tournament: id, draw: '1' })}`],
  ['/api/event-bundle', eventBundle, (id) => `/api/event-bundle?${q({ tournament: id, event: 'BS U15' })}`],
  ['/api/overview', overview, (id) => `/api/overview?${q({ tournament: id })}`],
  ['/api/clubs', clubs, (id) => `/api/clubs?${q({ tournament: id })}`],
  ['/api/stats', stats, (id) => `/api/stats?${q({ tournament: id })}`],
  ['/api/player', player, (id) => `/api/player?${q({ tournament: id, player: '7' })}`],
  ['/api/bat/player-ages', batAgesGet, (id) => `/api/bat/player-ages?${q({ tournament: id, ids: '1,2' })}`],
]

describe('a tournament id that is not a GUID', () => {
  for (const [name, route, url] of byTournament) {
    it.each(BAD_IDS)(`${name} refuses %j and asks nobody`, async (id) => {
      const res = await route(get(url(id)))
      expect(res.status).toBe(400)
      expectNothingAsked()
    })
  }

  it.each(BAD_IDS)('POST /api/bat/player-ages refuses %j and asks nobody', async (id) => {
    const res = await batAgesPost(new Request('http://localhost/api/bat/player-ages', {
      method: 'POST', body: JSON.stringify({ tournament: id, ids: ['1'] }),
    }))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })
})

describe('the other values that go into an upstream address', () => {
  it.each(['20261102&x=1', '../x', '2026-11-02T00:00', 'today'])('/api/matches refuses the date %j', async (date) => {
    const res = await matches(get(`/api/matches?${q({ tournament: GOOD, date })}`))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })

  it.each(['1/../2', '1&x=2', 'abc', '1234567'])('/api/bracket refuses the draw %j', async (event) => {
    const res = await bracket(get(`/api/bracket?${q({ tournament: GOOD, event })}`))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })

  it.each(['1/../2', 'abc'])('/api/group-refresh refuses the draw %j', async (draw) => {
    const res = await groupRefresh(get(`/api/group-refresh?${q({ tournament: GOOD, draw })}`))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })

  it.each(['7&player=8', 'x', '1234567890123'])('/api/player refuses the player %j', async (playerId) => {
    const res = await player(get(`/api/player?${q({ tournament: GOOD, player: playerId })}`))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })

  it('/api/event-bundle refuses an event name no event could have', async () => {
    const res = await eventBundle(get(`/api/event-bundle?${q({ tournament: GOOD, event: 'x'.repeat(200) })}`))
    expect(res.status).toBe(400)
    expectNothingAsked()
  })

  it('GET /api/bat/player-ages drops ids that are not numbers', async () => {
    ;(getBatPlayerYobs as jest.Mock).mockResolvedValue({})
    await batAgesGet(get(`/api/bat/player-ages?${q({ tournament: GOOD, ids: '1,2/../x,3&y=1,4' })}`))
    expect((getBatPlayerYobs as jest.Mock).mock.calls[0][1]).toEqual(['1', '4'])
  })
})
