jest.mock('../lib/push/config', () => ({ pushConfig: jest.fn() }))
jest.mock('../lib/push/store', () => ({ addFollow: jest.fn(), removeFollow: jest.fn(), touchRecord: jest.fn(), getRecord: jest.fn() }))
jest.mock('../lib/push/rate-limit', () => ({ allowNewDevice: jest.fn(), clientAddress: jest.fn().mockReturnValue('1.2.3.4') }))
jest.mock('../lib/push/clubs', () => ({ clubLookup: jest.fn() }))
jest.mock('../lib/push/tournaments', () => ({ alertTournaments: jest.fn() }))

import { GET as getKey } from '@/app/api/push/key/route'
import { POST as follow } from '@/app/api/push/follow/route'
import { POST as unfollow } from '@/app/api/push/unfollow/route'
import { POST as state } from '@/app/api/push/state/route'
import { pushConfig } from '@/lib/push/config'
import { addFollow, removeFollow, touchRecord, getRecord } from '@/lib/push/store'
import { allowNewDevice } from '@/lib/push/rate-limit'
import { clubLookup } from '@/lib/push/clubs'
import { alertTournaments } from '@/lib/push/tournaments'

const TID = 'aaaaaaaa-0000-0000-0000-000000000001'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const SUB = {
  endpoint: ENDPOINT,
  keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') },
}
const PLAYER = { kind: 'player', tournamentId: TID, playerId: '42', playerName: 'Anan Dee' }
const CLUB = { kind: 'club', tournamentId: TID, clubName: 'Red Club' }

const config = pushConfig as jest.Mock
const add = addFollow as jest.Mock
const remove = removeFollow as jest.Mock
const touch = touchRecord as jest.Mock
const known = getRecord as jest.Mock
const allow = allowNewDevice as jest.Mock
const clubs = clubLookup as jest.Mock
const listed = alertTournaments as jest.Mock

const post = (body: unknown) => new Request('http://x/api/push', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
  config.mockReset().mockReturnValue({ publicKey: 'PUB', privateKey: 'priv', subject: 'mailto:a@b.c' })
  add.mockReset().mockResolvedValue({ ok: true, follows: [{ kind: 'player' }] })
  remove.mockReset().mockResolvedValue([])
  touch.mockReset().mockResolvedValue([{ kind: 'player' }])
  known.mockReset().mockResolvedValue(null)
  allow.mockReset().mockReturnValue(true)
  clubs.mockReset().mockResolvedValue({ clubOf: () => undefined, hasClub: (n: string) => n === 'Red Club' })
  listed.mockReset().mockResolvedValue(new Map([[TID.toUpperCase(), { done: false }]]))
})

describe('GET /api/push/key', () => {
  it('gives the public key, and never the private one', async () => {
    const res = await getKey()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publicKey: 'PUB' })
  })
  it('is 404 when the feature is off', async () => {
    config.mockReturnValue(null)
    expect((await getKey()).status).toBe(404)
  })
})

describe('POST /api/push/follow', () => {
  it('follows a player', async () => {
    const res = await follow(post({ subscription: SUB, lang: 'th', target: PLAYER }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [{ kind: 'player' }] })
    const [sub, lang, target] = add.mock.calls[0]
    expect(sub).toEqual(SUB)
    expect(lang).toBe('th')
    expect(target).toEqual({ ...PLAYER, tournamentId: TID.toUpperCase() })
  })

  it('defaults an unknown language to English', async () => {
    await follow(post({ subscription: SUB, lang: 'xx', target: PLAYER }))
    expect(add.mock.calls[0][1]).toBe('en')
  })

  it('follows a club that exists in the tournament', async () => {
    expect((await follow(post({ subscription: SUB, lang: 'en', target: CLUB }))).status).toBe(200)
    expect(clubs).toHaveBeenCalledWith(TID.toUpperCase())
  })

  it('refuses a club the tournament does not have', async () => {
    const res = await follow(post({ subscription: SUB, lang: 'en', target: { ...CLUB, clubName: 'Made Up' } }))
    expect(res.status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{nope'],
    ['no subscription', { lang: 'en', target: PLAYER }],
    ['an endpoint off the push services', { subscription: { ...SUB, endpoint: 'https://evil.example/x' }, lang: 'en', target: PLAYER }],
    ['no target', { subscription: SUB, lang: 'en' }],
    ['a bad player id', { subscription: SUB, lang: 'en', target: { ...PLAYER, playerId: '1;x' } }],
  ])('is 400 for %s', async (_name, body) => {
    expect((await follow(post(body))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it('is 400 for a tournament the site does not list, so nobody can make the watcher poll a made-up id', async () => {
    listed.mockResolvedValue(new Map([['BBBBBBBB-0000-0000-0000-000000000002', { done: false }]]))
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(400)
    expect((await follow(post({ subscription: SUB, lang: 'en', target: CLUB }))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
    expect(clubs).not.toHaveBeenCalled()
  })

  it('still lets a finished tournament be followed (nothing is sent for it, and it can be unfollowed)', async () => {
    listed.mockResolvedValue(new Map([[TID.toUpperCase(), { done: true }]]))
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(200)
  })

  it.each(['player-limit', 'club-limit', 'device-limit'])('is 429 at the %s', async (reason) => {
    add.mockResolvedValue({ ok: false, reason })
    const res = await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe(reason)
  })

  it('is 429 for an address that has registered too many new devices today, with no "limit" reason', async () => {
    allow.mockReturnValue(false)
    const res = await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBeUndefined()
    expect(add).not.toHaveBeenCalled()
  })

  it('never holds back a device the server already knows', async () => {
    allow.mockReturnValue(false)
    known.mockResolvedValue({ endpoint: ENDPOINT, follows: [] })
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(200)
    expect(allow).not.toHaveBeenCalled()
  })

  it('does not count a refused request against the address', async () => {
    await follow(post({ subscription: SUB, lang: 'en', target: { ...PLAYER, playerId: '1;x' } }))
    listed.mockResolvedValue(new Map())
    await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))
    expect(allow).not.toHaveBeenCalled()
  })

  it('is 404 when the feature is off, and stores nothing', async () => {
    config.mockReturnValue(null)
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(404)
    expect(add).not.toHaveBeenCalled()
  })
})

describe('POST /api/push/unfollow', () => {
  it('unfollows without needing the player name', async () => {
    remove.mockResolvedValue([{ kind: 'club' }])
    const res = await unfollow(post({ endpoint: ENDPOINT, target: { kind: 'player', tournamentId: TID, playerId: '42' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [{ kind: 'club' }] })
    expect(remove).toHaveBeenCalledWith(ENDPOINT, { kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42' })
  })

  it('unfollows a club without checking it still exists', async () => {
    expect((await unfollow(post({ endpoint: ENDPOINT, target: { ...CLUB, clubName: 'Gone Club' } }))).status).toBe(200)
    expect(clubs).not.toHaveBeenCalled()
  })

  it.each([[{ target: PLAYER }], [{ endpoint: 'https://evil.example/x', target: PLAYER }], [{ endpoint: ENDPOINT }], ['{nope']])(
    'is 400 for %p', async (body) => {
      expect((await unfollow(post(body))).status).toBe(400)
      expect(remove).not.toHaveBeenCalled()
    })

  it('is 404 when the feature is off', async () => {
    config.mockReturnValue(null)
    expect((await unfollow(post({ endpoint: ENDPOINT, target: PLAYER }))).status).toBe(404)
  })
})

describe('POST /api/push/state', () => {
  it('returns the device\'s follows', async () => {
    const res = await state(post({ endpoint: ENDPOINT }))
    expect(await res.json()).toEqual({ follows: [{ kind: 'player' }] })
    expect(touch.mock.calls[0][0]).toBe(ENDPOINT)
  })
  it('is an empty list for a device the server does not know', async () => {
    touch.mockResolvedValue(null)
    const res = await state(post({ endpoint: ENDPOINT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [] })
  })
  it('is 400 for a bad endpoint and 404 when off', async () => {
    expect((await state(post({ endpoint: 'x' }))).status).toBe(400)
    config.mockReturnValue(null)
    expect((await state(post({ endpoint: ENDPOINT }))).status).toBe(404)
  })
  it('never lets a response be cached', async () => {
    expect((await state(post({ endpoint: ENDPOINT }))).headers.get('Cache-Control')).toBe('no-store')
  })
})
