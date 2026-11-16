import fs from 'fs'
import os from 'os'
import path from 'path'
import { RateLimiter, Cooldown, allowUpstream, UPSTREAM_LIMIT, UPSTREAM_WINDOW_MS, __resetUpstreamLimitForTesting } from '@/lib/rate-limit'
import { internalHeaders } from '@/lib/internal-token'

const cwd = process.cwd()
beforeEach(() => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'rl-')))
  __resetUpstreamLimitForTesting()
})
afterAll(() => { process.chdir(cwd) })

describe('RateLimiter', () => {
  it('allows up to the limit inside one window and refuses the next', () => {
    const rl = new RateLimiter(3, 1000)
    expect([rl.allow('a', 0), rl.allow('a', 10), rl.allow('a', 20), rl.allow('a', 30)]).toEqual([true, true, true, false])
  })

  it('starts again once the window has passed', () => {
    const rl = new RateLimiter(1, 1000)
    expect(rl.allow('a', 0)).toBe(true)
    expect(rl.allow('a', 999)).toBe(false)
    expect(rl.allow('a', 1000)).toBe(true)
  })

  it('counts each key on its own', () => {
    const rl = new RateLimiter(1, 1000)
    expect(rl.allow('a', 0)).toBe(true)
    expect(rl.allow('b', 0)).toBe(true)
    expect(rl.allow('a', 1)).toBe(false)
  })

  it('forgets the oldest keys instead of growing without bound', () => {
    const rl = new RateLimiter(1, 1000, 2)
    rl.allow('a', 0); rl.allow('b', 0); rl.allow('c', 0)
    // 'a' was dropped to make room, so it counts from nothing again.
    expect(rl.allow('a', 1)).toBe(true)
    expect(rl.allow('c', 1)).toBe(false)
  })
})

describe('Cooldown', () => {
  it('grants once, then not again until the time is up', () => {
    const cd = new Cooldown(10_000)
    expect(cd.take('k', 0)).toBe(true)
    expect(cd.take('k', 9_999)).toBe(false)
    expect(cd.take('k', 10_000)).toBe(true)
  })

  it('keeps each key apart', () => {
    const cd = new Cooldown(10_000)
    expect(cd.take('a', 0)).toBe(true)
    expect(cd.take('b', 1)).toBe(true)
  })

  it('forgets the oldest keys instead of growing without bound', () => {
    const cd = new Cooldown(10_000, 2)
    cd.take('a', 0); cd.take('b', 0); cd.take('c', 0)
    expect(cd.take('a', 1)).toBe(true)
  })
})

describe('allowUpstream', () => {
  const from = (address: string, extra: Record<string, string> = {}) =>
    new Request('http://x/api/matches', { headers: { 'cf-connecting-ip': address, ...extra } })

  it('lets one address cause only so many upstream requests a minute', () => {
    for (let i = 0; i < UPSTREAM_LIMIT; i++) expect(allowUpstream(from('203.0.113.5'), 'matches', 1000 + i)).toBe(true)
    expect(allowUpstream(from('203.0.113.5'), 'matches', 2000)).toBe(false)
  })

  it('does not hold one address to account for another', () => {
    for (let i = 0; i <= UPSTREAM_LIMIT; i++) allowUpstream(from('203.0.113.5'), 'matches', 1000)
    expect(allowUpstream(from('203.0.113.6'), 'matches', 1000)).toBe(true)
  })

  it('counts every route against the same allowance', () => {
    for (let i = 0; i < UPSTREAM_LIMIT; i++) allowUpstream(from('203.0.113.5'), i % 2 ? 'matches' : 'bracket', 1000)
    expect(allowUpstream(from('203.0.113.5'), 'h2h', 1000)).toBe(false)
  })

  it('lets the address through again a window later', () => {
    for (let i = 0; i <= UPSTREAM_LIMIT; i++) allowUpstream(from('203.0.113.5'), 'matches', 1000)
    expect(allowUpstream(from('203.0.113.5'), 'matches', 1000 + UPSTREAM_WINDOW_MS)).toBe(true)
  })

  // The app's own jobs ask its routes through 127.0.0.1, with no visitor
  // address on the request. They are not a visitor and are never limited.
  it('never limits a request that did not come through the proxy', () => {
    for (let i = 0; i < UPSTREAM_LIMIT * 3; i++) {
      expect(allowUpstream(new Request('http://127.0.0.1:3000/api/matches'), 'matches', 1000)).toBe(true)
    }
  })

  it('never limits a request carrying the server token', () => {
    const headers = internalHeaders()
    for (let i = 0; i < UPSTREAM_LIMIT * 3; i++) {
      expect(allowUpstream(from('203.0.113.5', headers), 'matches', 1000)).toBe(true)
    }
  })
})
