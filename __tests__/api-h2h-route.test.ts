jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))

import { batFetch } from '@/lib/bat-fetch'
import { GET } from '@/app/api/h2h/route'

const req = (path: string) => new Request(`http://localhost/api/h2h?path=${encodeURIComponent(path)}`)

beforeEach(() => {
  jest.resetAllMocks()
  ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, text: async () => '<html></html>' })
})

describe('GET /api/h2h', () => {
  it('fetches a BAT-relative path from BAT', async () => {
    const res = await GET(req('/tournament/ABC/Head2Head?id=7'))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledTimes(1)
    expect((batFetch as jest.Mock).mock.calls[0][1]).toBe('https://bat.tournamentsoftware.com/tournament/ABC/Head2Head?id=7')
  })

  it('fetches an absolute BAT url as given', async () => {
    const res = await GET(req('https://bat.tournamentsoftware.com/tournament/ABC/Head2Head?id=7'))
    expect(res.status).toBe(200)
    expect((batFetch as jest.Mock).mock.calls[0][1]).toBe('https://bat.tournamentsoftware.com/tournament/ABC/Head2Head?id=7')
  })

  // The server must never be talked into requesting another host: its own
  // loopback, a LAN device, or anything else a visitor names.
  it.each([
    ['its own loopback', 'http://127.0.0.1:3000/api/bmstats'],
    ['an IPv6 loopback', 'http://[::1]:3000/'],
    ['a LAN address', 'http://172.16.88.1/'],
    ['another site', 'https://evil.example/x'],
    ['a protocol-relative url', '//evil.example/x'],
    ['a look-alike host', 'https://bat.tournamentsoftware.com.evil.example/x'],
    ['BAT as the user name of another host', 'https://bat.tournamentsoftware.com@evil.example/x'],
    ['BAT over plain http', 'http://bat.tournamentsoftware.com/x'],
    ['BAT on another port', 'https://bat.tournamentsoftware.com:8443/x'],
  ])('refuses %s', async (_label, path) => {
    const res = await GET(req(path))
    expect(res.status).toBe(400)
    expect(batFetch).not.toHaveBeenCalled()
  })

  // Glued onto the host as text, these used to name a different host
  // altogether. As paths they can only ever be paths on BAT.
  it.each(['.evil.example/x', '@evil.example/x', ':8443@evil.example/x'])(
    'keeps %s on BAT',
    async (path) => {
      await GET(req(path))
      for (const call of (batFetch as jest.Mock).mock.calls) {
        expect(new URL(call[1] as string).origin).toBe('https://bat.tournamentsoftware.com')
      }
    },
  )

  describe('redirects', () => {
    const redirect = (location: string, status = 302) => ({ ok: false, status, headers: new Headers({ location }) })
    const page = { ok: true, status: 200, headers: new Headers(), text: async () => '<html></html>' }
    const fetched = () => (batFetch as jest.Mock).mock.calls.map((c) => c[1] as string)

    it('never lets the fetch follow a redirect by itself', async () => {
      await GET(req('/tournament/ABC/Head2Head?id=7'))
      expect((batFetch as jest.Mock).mock.calls[0][2]).toMatchObject({ redirect: 'manual' })
    })

    it('follows a redirect that stays on BAT', async () => {
      ;(batFetch as jest.Mock).mockReset()
      ;(batFetch as jest.Mock).mockResolvedValueOnce(redirect('/head-2-head/content?id=7')).mockResolvedValueOnce(page)
      const res = await GET(req('/tournament/ABC/Head2Head?id=7'))
      expect(res.status).toBe(200)
      expect(fetched()).toEqual([
        'https://bat.tournamentsoftware.com/tournament/ABC/Head2Head?id=7',
        'https://bat.tournamentsoftware.com/head-2-head/content?id=7',
      ])
    })

    it.each([
      ['another site', 'https://evil.example/x'],
      ['the server itself', 'http://127.0.0.1:3000/api/bmstats'],
      ['a LAN address', 'http://172.16.88.1/'],
      ['a protocol-relative address', '//evil.example/x'],
      ['BAT over plain http', 'http://bat.tournamentsoftware.com/x'],
    ])('stops at a redirect to %s', async (_label, location) => {
      ;(batFetch as jest.Mock).mockReset()
      ;(batFetch as jest.Mock).mockResolvedValueOnce(redirect(location)).mockResolvedValue(page)
      const res = await GET(req('/tournament/ABC/Head2Head?id=7'))
      expect(res.status).toBe(502)
      expect(fetched()).toEqual(['https://bat.tournamentsoftware.com/tournament/ABC/Head2Head?id=7'])
    })

    it('stops at a redirect that names nowhere', async () => {
      ;(batFetch as jest.Mock).mockReset()
      ;(batFetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers() }).mockResolvedValue(page)
      const res = await GET(req('/tournament/ABC/Head2Head?id=7'))
      expect(res.status).toBe(502)
      expect(batFetch).toHaveBeenCalledTimes(1)
    })

    it('gives up on a chain of redirects that never ends', async () => {
      ;(batFetch as jest.Mock).mockReset()
      ;(batFetch as jest.Mock).mockResolvedValue(redirect('/again'))
      const res = await GET(req('/tournament/ABC/Head2Head?id=7'))
      expect(res.status).toBe(502)
      expect((batFetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(6)
    })
  })
})
