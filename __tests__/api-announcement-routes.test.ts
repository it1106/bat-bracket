import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'

const PW = 'ann-route-password'
let dir = ''
let cwd = ''
beforeAll(() => {
  cwd = process.cwd()
  dir = mkdtempSync(path.join(os.tmpdir(), 'bat-ann-route-'))
  process.chdir(dir)
  process.env.BMSTATS_PASSWORD = PW
})
afterAll(() => {
  process.chdir(cwd)
  delete process.env.BMSTATS_PASSWORD
  rmSync(dir, { recursive: true, force: true })
})

const admin = async (method: 'GET' | 'POST', cookie?: string, body?: unknown) => {
  const mod = await import('@/app/api/bmstats/announcement/route')
  const req = new Request('http://localhost/api/bmstats/announcement', {
    method,
    headers: cookie ? { cookie, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return method === 'GET' ? mod.GET(req) : mod.POST(req)
}
const publicGet = async () => (await import('@/app/api/announcement/route')).GET()
const login = async () => {
  const { POST } = await import('@/app/api/bmstats/login/route')
  const res = await POST(new Request('http://localhost/api/bmstats/login', {
    method: 'POST', body: JSON.stringify({ password: PW }),
  }))
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

describe('/api/bmstats/announcement', () => {
  it('refuses GET and POST without a session', async () => {
    expect((await admin('GET')).status).toBe(401)
    const res = await admin('POST', undefined, { text: 'hi' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'login required' })
  })

  it('reports no announcement before anything is saved', async () => {
    expect(await (await admin('GET', await login())).json()).toEqual({ announcement: null })
  })

  it('saves and returns the new state', async () => {
    const res = await admin('POST', await login(), { text: 'ประกาศ' })
    expect(res.status).toBe(200)
    const { announcement } = await res.json()
    expect(announcement.text).toBe('ประกาศ')
    expect(announcement.id).toHaveLength(12)
  })

  it('rejects over-length and non-string text with a 400 and leaves the state alone', async () => {
    const cookie = await login()
    await admin('POST', cookie, { text: 'keep me' })
    expect((await admin('POST', cookie, { text: 'a'.repeat(501) })).status).toBe(400)
    expect((await admin('POST', cookie, { text: 7 })).status).toBe(400)
    expect((await (await admin('GET', cookie)).json()).announcement.text).toBe('keep me')
  })

  it('rejects a body that is not JSON with a 400', async () => {
    const cookie = await login()
    const mod = await import('@/app/api/bmstats/announcement/route')
    const res = await mod.POST(new Request('http://localhost/api/bmstats/announcement', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('turns the popup off on an empty text', async () => {
    const cookie = await login()
    await admin('POST', cookie, { text: 'on' })
    expect(await (await admin('POST', cookie, { text: '' })).json()).toEqual({ announcement: null })
  })
})

describe('/api/announcement', () => {
  it('needs no session and reports null when off', async () => {
    expect(await (await publicGet()).json()).toEqual({ announcement: null })
  })

  it('serves the id and text, and not updatedAt', async () => {
    await admin('POST', await login(), { text: 'public text' })
    const { announcement } = await (await publicGet()).json()
    expect(announcement.text).toBe('public text')
    expect(announcement.id).toHaveLength(12)
    expect(announcement.updatedAt).toBeUndefined()
  })

  it('answers no-store', async () => {
    expect((await publicGet()).headers.get('cache-control')).toContain('no-store')
  })
})
