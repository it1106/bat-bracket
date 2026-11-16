import { NextResponse } from 'next/server'
import { clientAddress } from './push/rate-limit'
import { isInternalRequest } from './internal-token'

// Limits on what one visitor can make the server ask BAT and BWF for.
//
// The scraping routes answer most requests from a cache that every visitor
// shares, and those cost the upstream nothing. What is counted here is the
// other kind: a request that is about to go upstream (a cache miss, or a
// route with no cache). A crowd on one venue's Wi-Fi shares an address but
// also shares the cache, so it stays far below the limit; a script walking
// made-up tournaments or dates misses every time and runs into it.
// In memory, bounded, per worker.

/** So many requests per key in each window of time. */
export class RateLimiter {
  private counts = new Map<string, { start: number; count: number }>()

  constructor(private limit: number, private windowMs: number, private maxKeys = 20_000) {}

  /** Counts one request for `key`. False when that puts it over the limit. */
  allow(key: string, now: number): boolean {
    let entry = this.counts.get(key)
    if (!entry || now - entry.start >= this.windowMs) {
      entry = { start: now, count: 0 }
      // re-insert so the map stays in order of window start, oldest first
      this.counts.delete(key)
      this.counts.set(key, entry)
      while (this.counts.size > this.maxKeys) {
        const oldest = this.counts.keys().next().value
        if (oldest === undefined) break
        this.counts.delete(oldest)
      }
    }
    entry.count++
    return entry.count <= this.limit
  }

  /** How many requests `key` has made in its current window. */
  count(key: string): number {
    return this.counts.get(key)?.count ?? 0
  }

  clear(): void {
    this.counts.clear()
  }
}

/** One go per key every so often. */
export class Cooldown {
  private last = new Map<string, number>()

  constructor(private everyMs: number, private maxKeys = 5_000) {}

  /** True, and the clock restarts, when `key` has not had a go lately. */
  take(key: string, now: number): boolean {
    const at = this.last.get(key)
    if (at !== undefined && now - at < this.everyMs) return false
    this.last.delete(key)
    this.last.set(key, now)
    while (this.last.size > this.maxKeys) {
      const oldest = this.last.keys().next().value
      if (oldest === undefined) break
      this.last.delete(oldest)
    }
    return true
  }

  /** Whether `key` could have a go now, without taking it. */
  ready(key: string, now: number): boolean {
    const at = this.last.get(key)
    return at === undefined || now - at >= this.everyMs
  }

  clear(): void {
    this.last.clear()
  }
}

// How often a visitor's `fresh=1` on /api/matches is honoured for one
// tournament day. The page sends it five seconds after a live match ends, so
// a read made for one visitor is new enough for everyone else who asks in the
// same breath; they share it instead of each costing BAT a request.
export const PUBLIC_FRESH_EVERY_MS = 10_000

const gf = globalThis as typeof globalThis & { __publicFreshGate?: Cooldown }
export const publicFreshGate = (gf.__publicFreshGate ??= new Cooldown(PUBLIC_FRESH_EVERY_MS))

export function __resetPublicFreshForTesting(): void {
  publicFreshGate.clear()
}

// Sized for a tournament hall, where a few hundred spectators can sit behind
// one address: their cache misses, player panels and head-to-heads together
// stay well under three a second. Raise it if `[rate-limit]` lines show real
// visitors being turned away; lower it if BAT ever objects to the volume.
export const UPSTREAM_LIMIT = 180
export const UPSTREAM_WINDOW_MS = 60_000

// On globalThis: Next bundles each route apart, and they must share one count.
const g = globalThis as typeof globalThis & { __upstreamLimiter?: RateLimiter }
const upstreamLimiter = (g.__upstreamLimiter ??= new RateLimiter(UPSTREAM_LIMIT, UPSTREAM_WINDOW_MS))

export function __resetUpstreamLimitForTesting(): void {
  upstreamLimiter.clear()
}

/** Whether this request may go upstream; counts it against its address.
 *  Call it only where the answer is not already in a cache.
 *
 *  Never limited: a request with the server's own token, and one with no
 *  visitor address on it at all. Visitors reach the app through Cloudflare,
 *  which always names them; a request without that came from the box itself
 *  (the app's background jobs call its own routes through 127.0.0.1) or from
 *  the LAN. */
export function allowUpstream(request: Request, route: string, now: number = Date.now()): boolean {
  const address = clientAddress(request)
  if (address === 'direct' || isInternalRequest(request)) return true
  if (upstreamLimiter.allow(address, now)) return true
  // One line per address per window, on the request that first goes over.
  if (upstreamLimiter.count(address) === UPSTREAM_LIMIT + 1) {
    console.log(`[rate-limit] upstream limit reached address=${address} route=${route}`)
  }
  return false
}

/** allowUpstream for a route with more than one place it might go upstream:
 *  ask at each of them, and the request is counted once, at the first. A
 *  request that never reaches one is never counted. */
export function upstreamGate(request: Request, route: string): () => boolean {
  let answer: boolean | null = null
  return () => (answer ??= allowUpstream(request, route))
}

/** The answer for a visitor over the limit when there is nothing cached to
 *  give them instead. */
export function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests — please try again in a minute' },
    { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
  )
}
