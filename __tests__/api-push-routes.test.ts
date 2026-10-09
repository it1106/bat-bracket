jest.mock('../lib/push/config', () => ({ pushConfig: jest.fn() }))
jest.mock('../lib/push/store', () => ({ addFollow: jest.fn(), removeFollow: jest.fn(), touchRecord: jest.fn() }))
jest.mock('../lib/push/clubs', () => ({ clubLookup: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({ listAllTournaments: jest.fn() }))

import { GET as getKey } from '@/app/api/push/key/route'
import { POST as follow } from '@/app/api/push/follow/route'
import { POST as unfollow } from '@/app/api/push/unfollow/route'
import { POST as state } from '@/app/api/push/state/route'
import { pushConfig } from '@/lib/push/config'
import { addFollow, removeFollow, touchRecord } from '@/lib/push/store'
import { clubLookup } from '@/lib/push/clubs'
import { listAllTournaments } from '@/lib/tournaments-registry'

const TID = 'aaaaaaaa-0000-0000-0000-000000000001'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const SUB = { endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }
const PLAYER = { kind: 'player', tournamentId: TID, playerId: '42', playerName: 'Anan Dee' }
const CLUB = { kind: 'club', tournamentId: TID, clubName: 'Red Club' }

const config = pushConfig as jest.Mock
const add = addFollow as jest.Mock
const remove = removeFollow as jest.Mock
const touch = touchRecord as jest.Mock
const clubs = clubLookup as jest.Mock
const registry = listAllTournaments as jest.Mock

const post = (body: unknown) => new Request('http://x/api/push', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
  config.mockReset().mockReturnValue({ publicKey: 'PUB', privateKey: 'priv', subject: 'mailto:a@b.c' })
  add.mockReset().mockResolvedValue({ ok: true, follows: [{ kind: 'player' }] })
  remove.mockReset().mockResolvedValue([])
  touch.mockReset().mockResolvedValue([{ kind: 'player' }])
  clubs.mockReset().mockResolvedValue({ clubOf: () => undefined, hasClub: (n: string) => n === 'Red Club' })
  registry.mockReset().mockReturnValue([{ id: TID.toUpperCase(), provider: 'bat', done: false }])
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

  it('is 400 for a BWF tournament', async () => {
    registry.mockReturnValue([{ id: TID.toUpperCase(), provider: 'bwf', done: false }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it('is 400 for a tournament the site does not list, so nobody can make the watcher poll a made-up id', async () => {
    registry.mockReturnValue([{ id: 'BBBBBBBB-0000-0000-0000-000000000002', provider: 'bat', done: false }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(400)
    expect((await follow(post({ subscription: SUB, lang: 'en', target: CLUB }))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
    expect(clubs).not.toHaveBeenCalled()
  })

  it('still lets a finished tournament be followed (nothing is sent for it, and it can be unfollowed)', async () => {
    registry.mockReturnValue([{ id: TID.toUpperCase(), provider: 'bat', done: true }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(200)
  })

  it.each(['player-limit', 'club-limit', 'device-limit'])('is 429 at the %s', async (reason) => {
    add.mockResolvedValue({ ok: false, reason })
    const res = await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe(reason)
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
