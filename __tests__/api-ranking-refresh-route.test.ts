jest.mock('../lib/ranking/fetch', () => ({ rankingFetch: jest.fn() }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { POST } from '@/app/api/ranking/[provider]/refresh/route'
import { readRankingCache, __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import { rankingFetch } from '@/lib/ranking/fetch'
import { internalHeaders } from '@/lib/internal-token'

const cwd = process.cwd()
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrf-'))
  __setRankingCacheRootForTesting(dir)
  // The server's own token lives under the working directory's .cache.
  process.chdir(dir)
  jest.clearAllMocks()
})
afterAll(() => { process.chdir(cwd) })

// The request the ranking scheduler makes: it carries the server's own token.
const req = () => new Request('http://x/api/ranking/bat/refresh?force=true', { method: 'POST', headers: internalHeaders() })
const ctx = { params: { provider: 'bat' } }

/** Overview page: publication dropdown (current + previous) plus one category
 *  header per event, matching the shape of bat.tournamentsoftware.com. */
function overview(pub: string, prevPub: string, date: string, cats: Array<[string, string]>): string {
  const opts = `<option selected="selected" value="${pub}">${date}</option><option value="${prevPub}">prev</option>`
  const headers = cats
    .map(([id, name]) => `<th colspan="9"><a href="category.aspx?id=${pub}&category=${id}">${name}</a></th>`)
    .join('')
  return `<html><span class="rankingdate">(${date})</span>
    <select class="publication">${opts}</select>
    <table class="ruler">${headers}</table></html>`
}

/** Category page with `n` ranked rows. */
function category(n: number, namePrefix: string): string {
  const rows = Array.from({ length: n }, (_, i) =>
    `<tr><td class="rank"><div>${i + 1}</div></td>` +
    `<td><a href="player.aspx?id=1&player=${900 + i}">${namePrefix}${i}</a></td>` +
    `<td class="right rankingpoints">${1000 - i}</td>` +
    `<td>3</td><td><a href="#">Club</a></td></tr>`).join('')
  return `<html><table>${rows}</table></html>`
}

/** Route BAT's URLs to canned HTML: two live series (Open 289 / Junior 189)
 *  plus a dead one, so the mock mirrors today's upstream. */
function mockUpstream(opts: { deadSeries?: string[] } = {}) {
  const dead = new Set(opts.deadSeries ?? [])
  ;(rankingFetch as jest.Mock).mockImplementation(async (_p: string, _k: string, url: string) => {
    const rid = url.match(/[?&]rid=(\d+)/)?.[1]
    if (rid) {
      if (dead.has(rid)) {
        // A retired series: 200, empty dropdown, no categories.
        return { ok: true, text: async () => '<html><span class="rankingdate">(1/1/0544)</span><select class="publication"></select></html>' }
      }
      const [pub, prev, cats]: [string, string, Array<[string, string]>] = rid === '289'
        ? ['53558', '53444', [['7755', "Men's Singles"], ['7756', "Women's Singles"]]]
        : ['53559', '53445', [['7725', 'U19 Boys singles'], ['7735', 'U15 Boys singles']]]
      return { ok: true, text: async () => overview(pub, prev, '1/9/2569', cats) }
    }
    if (url.includes('category.aspx')) {
      const page = Number(url.match(/[?&]p=(\d+)/)?.[1] ?? 1)
      if (page > 1) return { ok: true, text: async () => '<html></html>' }
      return { ok: true, text: async () => category(3, url.includes('id=53559') || url.includes('id=53445') ? 'J' : 'O') }
    }
    return { ok: false, status: 404, text: async () => '' }
  })
}

describe('POST /api/ranking/[provider]/refresh', () => {
  it('rejects unknown provider', async () => {
    const res = await POST(new Request('http://x/api/ranking/foo/refresh', { method: 'POST', headers: internalHeaders() }), { params: { provider: 'foo' } })
    expect(res.status).toBe(400)
  })

  // A refresh is hundreds of requests to BAT. Only the server's own scheduler
  // may start one; a visitor who finds the address may not.
  it('refuses a request without the server token, and scrapes nothing', async () => {
    mockUpstream()
    internalHeaders()
    const res = await POST(new Request('http://x/api/ranking/bat/refresh?force=true', { method: 'POST' }), ctx)
    expect(res.status).toBe(401)
    expect(rankingFetch).not.toHaveBeenCalled()
    expect(await readRankingCache('bat')).toBeNull()
  })

  it('refuses a request with the wrong token', async () => {
    mockUpstream()
    const [name] = Object.keys(internalHeaders())
    const res = await POST(
      new Request('http://x/api/ranking/bat/refresh?force=true', { method: 'POST', headers: { [name]: '0'.repeat(64) } }),
      ctx,
    )
    expect(res.status).toBe(401)
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('scrapes every BAT series into one snapshot, stamped per event', async () => {
    mockUpstream()
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)

    const cached = (await readRankingCache('bat'))!
    expect(cached.series).toEqual([
      { seriesId: '289', label: 'Open', rankingId: '53558', publishDate: '1/9/2569' },
      { seriesId: '189', label: 'Junior', rankingId: '53559', publishDate: '1/9/2569' },
    ])
    // Open events lead (they take the slot the retired U23 events had).
    expect(cached.events.map(e => e.eventCode)).toEqual(['MS', 'WS', 'U19_MS', 'U15_MS'])
    expect(cached.events.map(e => e.rankingId)).toEqual(['53558', '53558', '53559', '53559'])
    expect(cached.events.map(e => e.seriesId)).toEqual(['289', '289', '189', '189'])
    // Top-level fields describe the primary (first-configured) series.
    expect(cached.rankingId).toBe('53558')
    expect(cached.publishDate).toBe('1/9/2569')
  })

  it('keeps the live series when another one is retired, and says so', async () => {
    mockUpstream({ deadSeries: ['289'] })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failures).toEqual(['289: no categories on overview page'])

    const cached = (await readRankingCache('bat'))!
    expect(cached.series!.map(s => s.seriesId)).toEqual(['189'])
    expect(cached.events.map(e => e.eventCode)).toEqual(['U19_MS', 'U15_MS'])
  })

  it('preserves the cache and 502s when every series is retired', async () => {
    mockUpstream({ deadSeries: ['289', '189'] })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(502)
    expect(await readRankingCache('bat')).toBeNull()
  })
})

// ── A refresh that upstream fails part-way through ──────────────────────────
// A page or a whole category that could not be read used to be left out or
// cut short, and the result written over the cache as that week's ranking.
// Now a series that did not come through whole is never written short. If the
// cache already holds it, nothing is written at all — the series must not end
// up at two publications — and the cache keeps last week's date, so the next
// poll asks again. A series never held before is just left out.

type Failure = 'status' | 'throw' | undefined
interface Week {
  date: string
  open: [pub: string, prev: string]
  junior: [pub: string, prev: string]
  /** How many rows a category page holds (default: 3 on page 1, none after). */
  rows?: (url: string, page: number) => number
  fail?: (url: string) => Failure
}
const WEEK_1: Week = { date: '1/9/2569', open: ['53558', '53444'], junior: ['53559', '53445'] }
const WEEK_2: Week = { date: '8/9/2569', open: ['53600', '53558'], junior: ['53601', '53559'] }

function upstream(week: Week) {
  ;(rankingFetch as jest.Mock).mockImplementation(async (_p: string, _k: string, url: string) => {
    const failure = week.fail?.(url)
    if (failure === 'throw') throw new Error('connect ETIMEDOUT')
    if (failure === 'status') return { ok: false, status: 500, text: async () => '' }
    const rid = url.match(/[?&]rid=(\d+)/)?.[1]
    if (rid) {
      const [pub, prev] = rid === '289' ? week.open : week.junior
      const cats: Array<[string, string]> = rid === '289'
        ? [['7755', "Men's Singles"], ['7756', "Women's Singles"]]
        : [['7725', 'U19 Boys singles'], ['7735', 'U15 Boys singles']]
      return { ok: true, text: async () => overview(pub, prev, week.date, cats) }
    }
    const page = Number(url.match(/[?&]p=(\d+)/)?.[1] ?? 1)
    const n = week.rows ? week.rows(url, page) : page > 1 ? 0 : 3
    if (n === 0) return { ok: true, text: async () => '<html></html>' }
    // Rows are numbered on across pages, as upstream numbers them.
    const start = (page - 1) * 100
    const rows = Array.from({ length: n }, (_, i) =>
      `<tr><td class="rank"><div>${start + i + 1}</div></td>` +
      `<td><a href="player.aspx?id=1&player=${900 + start + i}">P${start + i}</a></td>` +
      `<td class="right rankingpoints">${5000 - start - i}</td>` +
      `<td>3</td><td><a href="#">Club</a></td></tr>`).join('')
    return { ok: true, text: async () => `<html><table>${rows}</table></html>` }
  })
}

const juniorU15In = (week: Week) => (url: string) =>
  url.includes('category.aspx') && url.includes(`id=${week.junior[0]}&`) && url.includes('category=7735')
const seriesOf = (c: { series?: Array<{ seriesId: string; rankingId: string; publishDate: string }> }) =>
  (c.series ?? []).map((x) => `${x.seriesId}:${x.rankingId}@${x.publishDate}`)

const unchanged = async (before: Awaited<ReturnType<typeof readRankingCache>>) => {
  const after = (await readRankingCache('bat'))!
  expect(after.scrapedAt).toBe(before!.scrapedAt)
  expect(seriesOf(after)).toEqual(seriesOf(before!))
  expect(after.events).toEqual(before!.events)
}

describe('POST /api/ranking/[provider]/refresh when upstream fails part-way', () => {
  async function weekOneIsCached(week: Week = WEEK_1) {
    upstream(week)
    expect((await POST(req(), ctx)).status).toBe(200)
    return (await readRankingCache('bat'))!
  }

  it('writes nothing when one category of a held series cannot be read', async () => {
    const before = await weekOneIsCached()
    upstream({ ...WEEK_2, fail: (url) => (juniorU15In(WEEK_2)(url) ? 'status' : undefined) })

    const res = await POST(req(), ctx)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/189/)
    // Open came through, but is not written apart from Junior.
    await unchanged(before)
  })

  it('does not write an event cut short by a page that failed', async () => {
    const twoPages = (_url: string, page: number) => (page === 1 ? 100 : page === 2 ? 30 : 0)
    const before = await weekOneIsCached({ ...WEEK_1, rows: twoPages })
    upstream({
      ...WEEK_2, rows: twoPages,
      fail: (url) => (juniorU15In(WEEK_2)(url) && url.includes('p=2') ? 'status' : undefined),
    })

    expect((await POST(req(), ctx)).status).toBe(502)

    const u15 = (await readRankingCache('bat'))!.events.find((e) => e.eventCode === 'U15_MS')!
    expect(u15.entries).toHaveLength(130)
    await unchanged(before)
  })

  it('treats a request that throws like one that fails', async () => {
    const before = await weekOneIsCached()
    upstream({ ...WEEK_2, fail: (url) => (juniorU15In(WEEK_2)(url) ? 'throw' : undefined) })
    expect((await POST(req(), ctx)).status).toBe(502)
    await unchanged(before)
  })

  it('writes nothing when a held series\'s overview page cannot be read', async () => {
    const before = await weekOneIsCached()
    upstream({ ...WEEK_2, fail: (url) => (/[?&]rid=189/.test(url) ? 'status' : undefined) })
    expect((await POST(req(), ctx)).status).toBe(502)
    await unchanged(before)
  })

  // The cache keeps last week's date, so the next poll still sees a new
  // publication upstream and refreshes; this time it comes through.
  it('moves both series on together once the failing part reads', async () => {
    await weekOneIsCached()
    upstream({ ...WEEK_2, fail: (url) => (juniorU15In(WEEK_2)(url) ? 'status' : undefined) })
    await POST(req(), ctx)
    upstream(WEEK_2)

    expect((await POST(req(), ctx)).status).toBe(200)
    expect(seriesOf((await readRankingCache('bat'))!)).toEqual(['289:53600@8/9/2569', '189:53601@8/9/2569'])
  })

  it('leaves a series out, rather than write it short, when there is no earlier copy of it', async () => {
    upstream({ ...WEEK_1, fail: (url) => (juniorU15In(WEEK_1)(url) ? 'status' : undefined) })

    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).failures.join(' ')).toMatch(/189/)

    const cached = (await readRankingCache('bat'))!
    expect(seriesOf(cached)).toEqual(['289:53558@1/9/2569'])
    expect(cached.events.map((e) => e.eventCode)).toEqual(['MS', 'WS'])
  })

  it('writes nothing, and says so, when no series could be read afresh', async () => {
    const before = await weekOneIsCached()
    upstream({ ...WEEK_2, fail: (url) => (url.includes('category.aspx') && /id=536/.test(url) ? 'status' : undefined) })
    expect((await POST(req(), ctx)).status).toBe(502)
    await unchanged(before)
  })

  // Last week's publication is read too, for each row's movement. If part of
  // that read fails, the copy already in the cache is the same publication
  // and is whole.
  it('takes last week\'s ranks from the cache when last week\'s page cannot be read', async () => {
    await weekOneIsCached()
    const prevMensSingles = (url: string) =>
      url.includes('category.aspx') && url.includes(`id=${WEEK_2.open[1]}&`) && url.includes('category=7755')
    upstream({ ...WEEK_2, fail: (url) => (prevMensSingles(url) ? 'status' : undefined) })

    expect((await POST(req(), ctx)).status).toBe(200)

    const ms = (await readRankingCache('bat'))!.events.find((e) => e.eventCode === 'MS')!
    expect(ms.rankingId).toBe('53600')
    expect(ms.entries.map((e) => e.previousRank)).toEqual([1, 2, 3])
  })
})
