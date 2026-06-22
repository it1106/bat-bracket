import { _resetForTesting, _setDriverForTesting, primeIfNeeded, request, closeContext, _internals } from '@/lib/providers/bwf/cf-context'

interface MockFetchCall { url: string; method: string }

function makeMockDriver() {
  const calls: { goto: string[]; fetch: MockFetchCall[]; close: number; launch: number } = {
    goto: [], fetch: [], close: 0, launch: 0,
  }
  let nextResponses: Array<{ status: number; body?: unknown }> = []
  let nextPageHtml = '<html><head><title>BWF Calendar</title></head><script>token: "tok-1"</script></html>'

  function makePage() {
    return {
      async goto(url: string) { calls.goto.push(url) },
      async content() { return nextPageHtml },
      async evaluate(_fn: unknown, arg: unknown) {
        const { url, method } = arg as { url: string; method: string }
        calls.fetch.push({ url, method })
        const r = nextResponses.shift() ?? { status: 200, body: {} }
        return { status: r.status, data: r.body }
      },
      async close() { /* noop */ },
    }
  }

  return {
    calls,
    setNextResponses(rs: Array<{ status: number; body?: unknown }>) { nextResponses = [...rs] },
    setNextPageHtml(html: string) { nextPageHtml = html },
    driver: {
      async launch() {
        calls.launch++
        return {
          async newPage() { return makePage() },
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

  it('closeContext tears down the browser so the next request re-primes cold', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await primeIfNeeded()
    expect(m.calls.launch).toBe(1)

    await closeContext()
    expect(m.calls.close).toBe(1)
    expect(_internals.getToken()).toBeNull()

    m.setNextResponses([{ status: 200, body: { ok: true } }])
    await request('POST', '/api/x')
    expect(m.calls.launch).toBe(2)
  })

  it('closeContext is a safe no-op when no browser is open', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await closeContext()
    expect(m.calls.close).toBe(0)
  })

  it('prime tears down the browser when token extraction fails (no leaked context)', async () => {
    const m = makeMockDriver()
    m.setNextPageHtml('<html><head><title>no token here</title></head></html>')
    _setDriverForTesting(m.driver as any)
    await expect(primeIfNeeded()).rejects.toThrow(/cannot extract token/)
    expect(m.calls.launch).toBe(1)
    expect(m.calls.close).toBe(1) // browser closed, not left holding the leaking primer page
    expect(_internals.getToken()).toBeNull()
  })

  it('re-primes cleanly on the next call after a prime failure', async () => {
    const m = makeMockDriver()
    m.setNextPageHtml('<html>no token</html>')
    _setDriverForTesting(m.driver as any)
    await expect(primeIfNeeded()).rejects.toThrow(/cannot extract token/)
    // A failed prime must not wedge the mutex or leave a stale context.
    m.setNextPageHtml('<html><head></head><script>token: "tok-2"</script></html>')
    await primeIfNeeded()
    expect(m.calls.launch).toBe(2)
    expect(_internals.getToken()).toBe('tok-2')
  })
})
