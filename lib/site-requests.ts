import { sharedCounter } from './bat-fetch-stats'
import { noteDaily } from './daily-history'

// How fast the site answers its visitors, for /bmstats: the data requests a
// page makes (schedules, brackets, players …) over the past 60 minutes, and
// today's totals. Fed by a hook on the HTTP server (see instrumentation.ts),
// so every route is covered without touching each one. The rolling hour is
// memory-only; today's counts are saved to disk.

const WINDOW_MS = 60 * 60_000
/** Slower than this and a visitor is looking at a spinner. */
export const SITE_SLOW_MS = 3000
const MAX_SAMPLES = 20_000

// The site's own housekeeping: heartbeats, page-load reports and this
// dashboard. Not something a visitor waits on, and the heartbeat alone would
// swamp everything else.
const HOUSEKEEPING = new Set(['presence', 'pageview', 'bmstats', 'search-aliases'])

/** The API route a URL belongs to, or null if it is not a visitor data request. */
export function routeOf(url: string | undefined): string | null {
  if (!url || !url.startsWith('/api/')) return null
  const route = url.slice(5).split(/[/?]/)[0]
  return !route || HOUSEKEEPING.has(route) ? null : route
}

export interface SiteRouteStats {
  route: string
  count: number
  medianMs: number
  p95Ms: number
  errors: number
}

export interface SiteStats {
  count: number
  medianMs: number | null
  p95Ms: number | null
  slow: number
  errors: number
  byRoute: SiteRouteStats[]
}

const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]

export class SiteRequests {
  private samples: Array<{ t: number; route: string; status: number; ms: number }> = []

  add(route: string, status: number, ms: number, now: number): void {
    this.samples.push({ t: now, route, status, ms })
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
  }

  stats(now: number): SiteStats {
    const cutoff = now - WINDOW_MS
    while (this.samples.length > 0 && this.samples[0].t < cutoff) this.samples.shift()
    if (this.samples.length === 0) return { count: 0, medianMs: null, p95Ms: null, slow: 0, errors: 0, byRoute: [] }
    const all = this.samples.map((s) => s.ms).sort((a, b) => a - b)
    const routes = new Map<string, { ms: number[]; errors: number }>()
    for (const s of this.samples) {
      let r = routes.get(s.route)
      if (!r) routes.set(s.route, (r = { ms: [], errors: 0 }))
      r.ms.push(s.ms)
      if (s.status >= 500) r.errors++
    }
    return {
      count: all.length,
      medianMs: percentile(all, 0.5),
      p95Ms: percentile(all, 0.95),
      slow: all.filter((ms) => ms > SITE_SLOW_MS).length,
      errors: this.samples.filter((s) => s.status >= 500).length,
      byRoute: Array.from(routes, ([route, r]) => {
        const sorted = r.ms.sort((a, b) => a - b)
        return { route, count: sorted.length, medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), errors: r.errors }
      }).sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)),
    }
  }
}

// On globalThis: the hook is installed from instrumentation, the figures are
// read from an API route, and Next may bundle the two separately.
const g = globalThis as typeof globalThis & { __siteRequests?: SiteRequests }
const window_ = g.__siteRequests ??= new SiteRequests()
const today = sharedCounter('__siteRequestStats', 'site-request-stats.json', { countStarts: false })

/** Called by the HTTP hook for every finished request. */
export function recordSiteRequest(url: string | undefined, status: number, ms: number): void {
  const route = routeOf(url)
  if (!route) return
  window_.add(route, status, ms, Date.now())
  today.record(route, status < 500)
  noteDaily('site', today.totals().today)
}

/** One row of the dashboard's request table: today's count (midnight to
 *  midnight, Bangkok) beside the past hour's figures. A route asked for today
 *  but not in the past hour has a zero count and no timings. */
export interface SiteRouteRow {
  route: string
  today: number
  count: number
  medianMs: number | null
  p95Ms: number | null
  errors: number
}

/** Joins the past hour's per-route figures with today's per-route counts,
 *  busiest today first. */
export function withTodayCounts(
  byRoute: SiteRouteStats[],
  todayByRoute: Array<{ kind: string; count: number }>,
): SiteRouteRow[] {
  const rows = new Map<string, SiteRouteRow>()
  for (const { kind, count } of todayByRoute) {
    rows.set(kind, { route: kind, today: count, count: 0, medianMs: null, p95Ms: null, errors: 0 })
  }
  for (const r of byRoute) rows.set(r.route, { ...r, today: rows.get(r.route)?.today ?? 0 })
  return Array.from(rows.values())
    .sort((a, b) => b.today - a.today || b.count - a.count || a.route.localeCompare(b.route))
}

export function getSiteStats(): Omit<SiteStats, 'byRoute'> & { today: number; errorsToday: number; byRoute: SiteRouteRow[] } {
  const totals = today.totals()
  const hour = window_.stats(Date.now())
  return {
    ...hour,
    byRoute: withTodayCounts(hour.byRoute, today.stats().byKind),
    today: totals.today,
    errorsToday: totals.failedToday,
  }
}
