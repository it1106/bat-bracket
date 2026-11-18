import { appendNews, newsEventsFrom, type SiteNews } from '@/lib/site-news'
import { recentUpdates } from '@/lib/tournament-news'
import type { Publication } from '@/lib/push/types'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString()

const pubs: Publication[] = [
  { kind: 'tournament', tournamentId: 'T', tournamentName: 'New', items: [] },
  { kind: 'bracket', tournamentId: 'A', tournamentName: 'Alpha', items: ['MS U15'] },
  { kind: 'schedule', tournamentId: 'B', tournamentName: 'Beta', items: ['2026-11-20'] },
]

describe('newsEventsFrom', () => {
  it('keeps draws and schedules, not new tournaments (discovery announces those)', () => {
    const events = newsEventsFrom(pubs, iso(0))
    expect(events.map((e) => [e.kind, e.tournamentId, e.id])).toEqual([
      ['bracket', 'A', `b:A:${iso(0)}`],
      ['schedule', 'B', `s:B:${iso(0)}`],
    ])
  })
})

describe('appendNews', () => {
  it('drops events older than a week and caps the file', () => {
    const old: SiteNews = { version: 1, events: newsEventsFrom(pubs, iso(24 * 8)) }
    const next = appendNews(old, newsEventsFrom(pubs, iso(0)), NOW)
    expect(next.events.every((e) => e.at === iso(0))).toBe(true)
  })
})

describe('recentUpdates', () => {
  const news: SiteNews = {
    version: 1,
    events: [
      ...newsEventsFrom([pubs[1]], iso(5)),
      ...newsEventsFrom([{ ...pubs[2], items: ['2026-11-17', '2026-11-19'] }], iso(1)),
      ...newsEventsFrom([{ ...pubs[2], tournamentId: 'C', items: ['2026-11-10'] }], iso(2)),
      ...newsEventsFrom([{ ...pubs[1], tournamentId: 'OLD' }], iso(24 * 4)),
      ...newsEventsFrom([{ ...pubs[1], tournamentId: 'HIDDEN' }], iso(1)),
      ...newsEventsFrom([{ ...pubs[1], tournamentId: 'DONE' }], iso(1)),
    ],
  }
  const visible = [
    { id: 'A', name: 'Alpha (listed)' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' },
    { id: 'OLD', name: 'Old' }, { id: 'DONE', name: 'Done', done: true },
  ]

  it('keeps recent updates for shown tournaments, newest first, with past schedule days dropped', () => {
    const out = recentUpdates(news, visible, NOW, '2026-11-18')
    expect(out.map((u) => [u.tournamentId, u.tournamentName, u.items])).toEqual([
      ['B', 'Beta', ['2026-11-19']],
      ['A', 'Alpha (listed)', ['MS U15']],
    ])
  })
})
