jest.mock('../lib/ranking/fetch', () => ({ rankingFetch: jest.fn() }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { POST } from '@/app/api/ranking/[provider]/refresh/route'
import { readRankingCache, __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import { rankingFetch } from '@/lib/ranking/fetch'

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrf-'))
  __setRankingCacheRootForTesting(dir)
  jest.clearAllMocks()
})

const req = () => new Request('http://x/api/ranking/bat/refresh?force=true', { method: 'POST' })
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
    const res = await POST(new Request('http://x/api/ranking/foo/refresh', { method: 'POST' }), { params: { provider: 'foo' } })
    expect(res.status).toBe(400)
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
