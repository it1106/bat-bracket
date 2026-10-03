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
