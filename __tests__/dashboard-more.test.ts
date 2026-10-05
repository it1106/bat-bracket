import { routeOf, SiteRequests } from '@/lib/site-requests'
import { parseProcStat, sumBrowser } from '@/lib/browser-usage'
import { parseDu } from '@/lib/disk-usage'

describe('routeOf', () => {
  it.each([
    ['/api/matches?tournament=X&date=1', 'matches'],
    ['/api/bracket?tournament=x&event=2', 'bracket'],
    ['/api/players/search?q=a', 'players'],
    ['/api/bat/player-ages?ids=1', 'bat'],
    ['/api/draws', 'draws'],
  ])('files %s under %s', (url, route) => {
    expect(routeOf(url)).toBe(route)
  })

  it.each([
    '/', '/bmstats', '/_next/static/chunks/a.js', '/ingest/e', '/favicon.ico', undefined,
    // The site's own housekeeping, not something a visitor waits on.
    '/api/presence', '/api/pageview', '/api/bmstats', '/api/bmstats/login', '/api/search-aliases',
  ])('leaves %s out', (url) => {
    expect(routeOf(url)).toBeNull()
  })
})

describe('SiteRequests', () => {
  const NOW = Date.UTC(2026, 9, 4, 3, 0, 0)

  it('summarises the past hour overall and by route', () => {
    const s = new SiteRequests()
    for (let i = 1; i <= 10; i++) s.add('matches', 200, i * 100, NOW) // 100…1000 ms
    s.add('bracket', 500, 4000, NOW)
    s.add('bracket', 200, 200, NOW)
    expect(s.stats(NOW)).toEqual({
      count: 12,
      medianMs: 500,
      p95Ms: 4000,
      slow: 1,
      errors: 1,
      byRoute: [
        { route: 'matches', count: 10, medianMs: 500, p95Ms: 1000, errors: 0 },
        { route: 'bracket', count: 2, medianMs: 200, p95Ms: 4000, errors: 1 },
      ],
    })
  })

  it('counts only server errors as errors', () => {
    const s = new SiteRequests()
    s.add('matches', 404, 10, NOW)
    s.add('matches', 400, 10, NOW)
    s.add('matches', 503, 10, NOW)
    expect(s.stats(NOW).errors).toBe(1)
  })

  it('forgets requests older than an hour and reports an empty hour', () => {
    const s = new SiteRequests()
    s.add('matches', 200, 5000, NOW - 61 * 60_000)
    expect(s.stats(NOW)).toEqual({ count: 0, medianMs: null, p95Ms: null, slow: 0, errors: 0, byRoute: [] })
  })
})

describe('browser usage', () => {
  // /proc/<pid>/stat: pid (comm) state ppid … utime(14) stime(15) … rss(24)
  const stat = (pid: number, comm: string, utime: number, stime: number, rss: number) =>
    `${pid} (${comm}) S 1 1 1 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 5 0 100 1000000 ${rss} 18446744073709551615`

  it('reads a process name, CPU ticks and memory pages', () => {
    expect(parseProcStat(stat(42, 'chrome-headless', 300, 50, 2000))).toEqual({ comm: 'chrome-headless', ticks: 350, rssPages: 2000 })
  })

  it('copes with spaces and brackets in the process name', () => {
    expect(parseProcStat(stat(7, 'Web Content (x)', 1, 2, 3))).toEqual({ comm: 'Web Content (x)', ticks: 3, rssPages: 3 })
  })

  it('returns null for something that is not a stat line', () => {
    expect(parseProcStat('')).toBeNull()
    expect(parseProcStat('garbage')).toBeNull()
  })

  it('adds up only the browser\'s processes', () => {
    const procs = [
      { comm: 'chrome-headless', ticks: 100, rssPages: 1000 },
      { comm: 'chrome-headless', ticks: 20, rssPages: 500 },
      { comm: 'next-server (v1', ticks: 999, rssPages: 99999 },
      { comm: 'chromium', ticks: 5, rssPages: 100 },
    ]
    expect(sumBrowser(procs)).toEqual({ processes: 3, ticks: 125, rssPages: 1600 })
  })
})

describe('parseDu', () => {
  it('reads sizes in kilobytes and names relative to the app folder', () => {
    const out = '205000\t/root/app/.cache/brackets\n350000\t/root/app/.cache/players\n12\t/root/app/.cache/presence.json\n900000\t/root/app/node_modules\n'
    expect(parseDu(out, '/root/app')).toEqual([
      { name: 'node_modules', bytes: 900000 * 1024 },
      { name: '.cache/players', bytes: 350000 * 1024 },
      { name: '.cache/brackets', bytes: 205000 * 1024 },
      { name: '.cache/presence.json', bytes: 12 * 1024 },
    ])
  })

  it('keeps a path outside the app folder as it is, and skips junk lines', () => {
    expect(parseDu('500\t/root/.pm2/logs\nnonsense\n\n', '/root/app')).toEqual([{ name: '/root/.pm2/logs', bytes: 512000 }])
  })
})

import { withTodayCounts } from '@/lib/site-requests'

describe('withTodayCounts', () => {
  const hour = [
    { route: 'matches', count: 40, medianMs: 120, p95Ms: 900, errors: 1 },
    { route: 'bracket', count: 5, medianMs: 80, p95Ms: 200, errors: 0 },
  ]

  it('puts today\'s count beside the past hour\'s figures, busiest today first', () => {
    expect(withTodayCounts(hour, [{ kind: 'bracket', count: 900 }, { kind: 'matches', count: 300 }])).toEqual([
      { route: 'bracket', today: 900, count: 5, medianMs: 80, p95Ms: 200, errors: 0 },
      { route: 'matches', today: 300, count: 40, medianMs: 120, p95Ms: 900, errors: 1 },
    ])
  })

  it('lists a route asked for today but not in the past hour, without timings', () => {
    expect(withTodayCounts(hour, [{ kind: 'matches', count: 300 }, { kind: 'bracket', count: 9 }, { kind: 'h2h', count: 15 }]))
      .toEqual([
        { route: 'matches', today: 300, count: 40, medianMs: 120, p95Ms: 900, errors: 1 },
        { route: 'h2h', today: 15, count: 0, medianMs: null, p95Ms: null, errors: 0 },
        { route: 'bracket', today: 9, count: 5, medianMs: 80, p95Ms: 200, errors: 0 },
      ])
  })

  it('keeps a route seen in the past hour that today\'s counts do not have yet', () => {
    expect(withTodayCounts(hour, [])).toEqual([
      { route: 'matches', today: 0, count: 40, medianMs: 120, p95Ms: 900, errors: 1 },
      { route: 'bracket', today: 0, count: 5, medianMs: 80, p95Ms: 200, errors: 0 },
    ])
  })
})

