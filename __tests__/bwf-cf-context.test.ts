import { _resetForTesting, _setDriverForTesting, primeIfNeeded, request, _internals } from '@/lib/providers/bwf/cf-context'

interface MockFetchCall { url: string; method: string }

function makeMockDriver() {
  const calls: { goto: string[]; fetch: MockFetchCall[]; close: number; launch: number } = {
    goto: [], fetch: [], close: 0, launch: 0,
  }
  let nextResponses: Array<{ status: number; body?: unknown }> = []
  let nextPageHtml = '<html><head><title>Tournament | MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026</title></head><script type="text/javascript">var app = new Vue({ el: \'#app\', data: { mainTmtId: 5726, tmtId: 5726, tournamentCode: \'6E65C36E-497D-42D2-8F4E-78A2D30D9893\', tournamentSlug: \'mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026\', token: "tok-1" } });</script></html>'

  return {
    calls,
    setNextResponses(rs: Array<{ status: number; body?: unknown }>) { nextResponses = [...rs] },
    setNextPageHtml(html: string) { nextPageHtml = html },
    driver: {
      async launch() {
        calls.launch++
        return {
          async newPage() {
            return {
              async goto(url: string) { calls.goto.push(url) },
              async content() { return nextPageHtml },
              async close() { /* noop */ },
            }
          },
          request: {
            async fetch(url: string, opts: { method: string }) {
              calls.fetch.push({ url, method: opts.method })
              const r = nextResponses.shift() ?? { status: 200, body: {} }
              return {
                status: () => r.status,
                json: async () => r.body,
              }
            },
          },
          async close() { calls.close++ },
        }
      },
    },
  }
}

describe('cf-context state machine', () => {
  beforeEach(() => { _resetForTesting() })

  it('prime launches Chromium and extracts token', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await primeIfNeeded()
    expect(m.calls.launch).toBe(1)
    expect(m.calls.goto.length).toBeGreaterThanOrEqual(1)
    expect(_internals.getToken()).toBe('tok-1')
  })

  it('prime is mutex-protected (concurrent callers share one launch)', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await Promise.all([primeIfNeeded(), primeIfNeeded(), primeIfNeeded()])
    expect(m.calls.launch).toBe(1)
  })

  it('request returns parsed JSON on 200', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x', { a: 1 })
    expect(r).toEqual({ ok: true })
    expect(m.calls.fetch[0].url).toBe('https://extranet-lv.bwfbadminton.com/api/x')
  })

  it('retries once on 401 after re-extracting token', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 401 }, { status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x')
    expect(r).toEqual({ ok: true })
    expect(m.calls.fetch.length).toBe(2)
    expect(m.calls.goto.length).toBeGreaterThanOrEqual(2) // initial prime + reload
  })

  it('retries once on 403 by re-priming the context', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 403 }, { status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x')
    expect(r).toEqual({ ok: true })
    expect(m.calls.launch).toBeGreaterThanOrEqual(2)
  })

  it('throws on persistent 5xx', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 502 }])
    _setDriverForTesting(m.driver as any)
    await expect(request('POST', '/api/x')).rejects.toThrow(/502/)
  })
})
