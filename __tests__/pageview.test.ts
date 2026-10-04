import { pageKind } from '@/lib/pageview-stats'

describe('pageKind', () => {
  it.each([
    ['/', 'home'],
    ['/player/bat/somchai_jaidee', 'player'],
    ['/player/bwf/kunlavut_vitidsarn', 'player'],
    ['/leaderboards', 'leaderboards'],
    ['/country-matrix', 'country-matrix'],
    ['/disclaimer', 'disclaimer'],
    ['/privacy', 'privacy'],
    ['/bmstats', 'bmstats'],
    ['/leaderboards/', 'leaderboards'],
    ['/something-new/deep', 'other'],
  ])('files %s under %s', (path, kind) => {
    expect(pageKind(path)).toBe(kind)
  })

  it.each([undefined, null, 7, '', 'no-slash', '/x'.repeat(200)])('rejects %p', (path) => {
    expect(pageKind(path)).toBeNull()
  })
})

describe('POST /api/pageview', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/pageview/route')
    return POST(new Request('http://localhost/api/pageview', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('counts a page load under its page type', async () => {
    const { getPageviewStats } = await import('@/lib/pageview-stats')
    const before = getPageviewStats().today
    expect((await post({ path: '/player/bat/somchai' })).status).toBe(204)
    expect((await post({ path: '/' })).status).toBe(204)
    const after = getPageviewStats()
    expect(after.today).toBe(before + 2)
    expect(after.byKind).toEqual(expect.arrayContaining([
      { kind: 'player', count: 1 },
      { kind: 'home', count: 1 },
    ]))
    expect(after.lastHour).toBeGreaterThanOrEqual(2)
  })

  it('ignores a request without a usable path', async () => {
    const { getPageviewStats } = await import('@/lib/pageview-stats')
    const before = getPageviewStats().today
    expect((await post({ path: 'javascript:alert(1)' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect(getPageviewStats().today).toBe(before)
  })
})
