import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'

jest.mock('../lib/presence-persist', () => ({ ensurePresenceLoaded: jest.fn(), schedulePresenceSave: jest.fn() }))
jest.mock('../lib/server-status', () => ({ getServerStatus: jest.fn().mockResolvedValue({ cpu: { percent: 1 } }) }))

const PW = 'route-test-password'
let dir = ''
let cwd = ''

beforeAll(() => {
  cwd = process.cwd()
  dir = mkdtempSync(path.join(os.tmpdir(), 'bmstats-route-'))
  process.chdir(dir)
  process.env.BMSTATS_PASSWORD = PW
})
afterAll(() => {
  process.chdir(cwd)
  delete process.env.BMSTATS_PASSWORD
  rmSync(dir, { recursive: true, force: true })
})

const login = async (password: unknown) => {
  const { POST } = await import('@/app/api/bmstats/login/route')
  return POST(new Request('http://localhost/api/bmstats/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }))
}
const stats = async (cookie?: string) => {
  const { GET } = await import('@/app/api/bmstats/route')
  return GET(new Request('http://localhost/api/bmstats', { headers: cookie ? { cookie } : {} }))
}
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]

describe('/api/bmstats access', () => {
  it('refuses the figures without a session', async () => {
    const res = await stats()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'login required' })
  })

  it('refuses a made-up session cookie', async () => {
    expect((await stats('bmstats_session=9999999999999.deadbeef')).status).toBe(401)
  })

  it('rejects a wrong password and sets no cookie', async () => {
    const res = await login('nope')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('serves the figures after logging in with the right password', async () => {
    const res = await login(PW)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^bmstats_session=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)

    const ok = await stats(cookieOf(res))
    expect(ok.status).toBe(200)
    expect((await ok.json()).cpu).toEqual({ percent: 1 })
  })

  it('clears the cookie on logout', async () => {
    const { POST } = await import('@/app/api/bmstats/logout/route')
    const res = await POST(new Request('http://localhost/api/bmstats/logout', { method: 'POST' }))
    expect(res.headers.get('set-cookie')).toMatch(/bmstats_session=;.*Max-Age=0/i)
  })

  it('lets nobody in when no password is configured', async () => {
    delete process.env.BMSTATS_PASSWORD
    const res = await login('')
    expect(res.status).toBe(503)
    process.env.BMSTATS_PASSWORD = PW
  })
})

describe('search aliases API', () => {
  const session = async () => cookieOf(await login(PW))
  const admin = async (method: string, cookie?: string, body?: unknown, query = '') => {
    const mod = await import('@/app/api/bmstats/aliases/route')
    const handler = mod[method as 'GET' | 'POST' | 'DELETE']
    return handler(new Request(`http://localhost/api/bmstats/aliases${query}`, {
      method,
      headers: cookie ? { cookie } : {},
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }))
  }
  const publicList = async () => {
    const { GET } = await import('@/app/api/search-aliases/route')
    return (await (await GET()).json()).aliases as Record<string, string>
  }

  it('lets anyone read the aliases, since every visitor\'s search uses them', async () => {
    expect((await publicList()).ren).toBe('รวิณ')
  })

  it('refuses changes without a login', async () => {
    expect((await admin('POST', undefined, { key: 'smash', value: 'ทีมสแมช' })).status).toBe(401)
    expect((await admin('DELETE', undefined, undefined, '?key=ren')).status).toBe(401)
    expect((await admin('GET')).status).toBe(401)
    expect('smash' in (await publicList())).toBe(false)
  })

  it('adds, replaces and removes an alias when logged in', async () => {
    const cookie = await session()
    const added = await admin('POST', cookie, { key: ' Smash ', value: 'ทีมสแมช' })
    expect(added.status).toBe(200)
    expect((await added.json()).aliases.smash).toBe('ทีมสแมช')
    expect((await publicList()).smash).toBe('ทีมสแมช')

    await admin('POST', cookie, { key: 'smash', value: 'สแมช' })
    expect((await publicList()).smash).toBe('สแมช')

    const removed = await admin('DELETE', cookie, undefined, '?key=smash')
    expect(removed.status).toBe(200)
    expect('smash' in (await publicList())).toBe(false)
  })

  it('explains why an alias was rejected', async () => {
    const res = await admin('POST', await session(), { key: 'x', value: 'y' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 2/)
  })

  it('says so when asked to remove an alias that does not exist', async () => {
    expect((await admin('DELETE', await session(), undefined, '?key=nobody')).status).toBe(404)
  })
})

describe('/api/bmstats match alerts', () => {
  const session = async () => cookieOf(await login(PW))

  it('lists each following device by a hash, never by its endpoint or keys', async () => {
    const { addFollow, __setPushRootForTesting } = await import('@/lib/push/store')
    const { endpointHash } = await import('@/lib/push/devices')
    __setPushRootForTesting(path.join(dir, 'push-store'))
    const endpoint = 'https://wns2-sg2p.notify.windows.com/w/?token=secret-token'
    await addFollow(
      { endpoint, keys: { p256dh: 'p256dh-secret', auth: 'auth-secret' } },
      'en',
      { kind: 'player', tournamentId: '704595c5-4a11-4093-a254-6791021df219', playerId: '2588', playerName: 'ปริญญา พุฒิไพรสกุล' },
      Date.parse('2026-10-09T03:21:36.386Z'),
    )

    const body = await (await stats(await session())).json()
    expect(body.push.deviceTotal).toBe(1)
    expect(body.push.devices).toHaveLength(1)
    expect(body.push.devices[0].id).toBe(endpointHash(endpoint))
    expect(body.push.devices[0].service).toBe('Edge')
    expect(body.push.devices[0].follows[0]).toMatchObject({ kind: 'player', playerId: '2588', name: 'ปริญญา พุฒิไพรสกุล' })

    const json = JSON.stringify(body.push)
    expect(json).not.toContain('secret-token')
    expect(json).not.toContain('p256dh-secret')
    expect(json).not.toContain('auth-secret')
  })

  it('names a tournament the site discovered by itself, not only the hand-listed ones', async () => {
    const { addFollow, __setPushRootForTesting } = await import('@/lib/push/store')
    const { saveDiscovered } = await import('@/lib/discovery-store')
    __setPushRootForTesting(path.join(dir, 'push-store-discovered'))
    await saveDiscovered({
      version: 1,
      entries: [{
        id: '704595C5-4A11-4093-A254-6791021DF219',
        name: 'LI-NING Pathumthani Championship 2026',
        hasBracket: true,
        discoveredAt: '2026-09-17T01:06:10.944Z',
        lastSeenOnUpcomingAt: '2026-10-09T04:04:04.872Z',
      }],
    })
    await addFollow(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/discovered', keys: { p256dh: 'k', auth: 'k' } },
      'en',
      { kind: 'player', tournamentId: '704595C5-4A11-4093-A254-6791021DF219', playerId: '2503', playerName: 'รวิณ ชูชัยศรี' },
      Date.parse('2026-10-09T02:01:40.713Z'),
    )

    const body = await (await stats(await session())).json()
    expect(body.push.devices[0].follows[0].tournamentName).toBe('LI-NING Pathumthani Championship 2026')
  })

  it('serves the alerts that have gone out, newest first', async () => {
    const recent = await import('@/lib/push/recent-sends')
    recent.__setRecentSendsRootForTesting(path.join(dir, 'recent-sends'))
    await recent.recordSend({
      at: '2026-10-09T03:26:04.000Z', device: '02533ab321f9a162', stage: 'soon', result: 'ok',
      draw: 'BS U17', round: 'Round of 128', match: 'ชยพัทธ์ รอดแย้ม v ณัฐปภัสร์ ตันติวิริยางกูร', via: 'UNITY&RAWIN',
    })
    await recent.recordSend({
      at: '2026-10-09T03:55:04.000Z', device: '02533ab321f9a162', stage: 'result', result: 'ok',
      draw: 'BS U17', round: 'Round of 128', match: 'ปริญญา พุฒิไพรสกุล v ธนากร วรวาส', via: 'ปริญญา พุฒิไพรสกุล',
    })

    const body = await (await stats(await session())).json()
    expect(body.push.recentSends.map((r: { stage: string }) => r.stage)).toEqual(['result', 'soon'])
    expect(body.push.recentSends[1].via).toBe('UNITY&RAWIN')
  })
})
