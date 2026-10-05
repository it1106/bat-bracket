import { PresenceStore, UNKNOWN_COUNTRY } from '@/lib/presence'

// Noon in Bangkok on 2 Oct 2026.
const NOON = Date.UTC(2026, 9, 2, 5)
const DAY = 86_400_000

describe('today\'s users by country', () => {
  it('counts each device once, under the country it was first seen in', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH')
    s.touch('device-aaaa', NOON + 1000, 'TH')
    s.touch('device-bbbb', NOON + 2000, 'TH')
    s.touch('device-cccc', NOON + 3000, 'US')
    // The same visitor later, from somewhere else: still one user, still TH.
    s.touch('device-aaaa', NOON + 4000, 'SG')
    expect(s.usersByCountry(NOON + 5000)).toEqual([
      { country: 'TH', count: 2 },
      { country: 'US', count: 1 },
    ])
    expect(s.users(NOON + 5000)).toBe(3)
  })

  it('files a device under Unknown until a heartbeat says where it is', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON)
    s.touch('device-bbbb', NOON, 'not a country')
    expect(s.usersByCountry(NOON)).toEqual([{ country: UNKNOWN_COUNTRY, count: 2 }])
    s.touch('device-aaaa', NOON + 1000, 'TH')
    expect(s.usersByCountry(NOON + 1000)).toEqual([
      { country: 'TH', count: 1 },
      { country: UNKNOWN_COUNTRY, count: 1 },
    ])
  })

  it('keeps a request that came around Cloudflare apart', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'direct')
    expect(s.usersByCountry(NOON)).toEqual([{ country: 'direct', count: 1 }])
  })

  it('starts again at midnight', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH')
    expect(s.usersByCountry(NOON + DAY)).toEqual([])
  })

  it('survives a save and restore', () => {
    const a = new PresenceStore()
    a.touch('device-aaaa', NOON, 'TH')
    a.touch('device-bbbb', NOON, 'US')
    a.touch('device-cccc', NOON)
    const b = new PresenceStore()
    b.restore(JSON.parse(JSON.stringify(a.snapshot(NOON))), NOON)
    expect(b.usersByCountry(NOON)).toEqual(a.usersByCountry(NOON))
  })

  it('restores a snapshot saved before countries were kept, then fills them in', () => {
    const s = new PresenceStore()
    s.restore({ day: '2026-10-02', peak: { count: 2, at: NOON }, ids: ['device-aaaa', 'device-bbbb'] }, NOON)
    expect(s.usersByCountry(NOON)).toEqual([{ country: UNKNOWN_COUNTRY, count: 2 }])
    s.touch('device-aaaa', NOON, 'TH')
    expect(s.usersByCountry(NOON)).toEqual([{ country: 'TH', count: 1 }, { country: UNKNOWN_COUNTRY, count: 1 }])
  })

  it('does not take a country from a damaged snapshot', () => {
    const s = new PresenceStore()
    s.restore({
      day: '2026-10-02',
      peak: { count: 0, at: null },
      ids: ['device-aaaa', 'device-bbbb'],
      countries: ['<script>', 7 as unknown as string],
    }, NOON)
    expect(s.usersByCountry(NOON)).toEqual([{ country: UNKNOWN_COUNTRY, count: 2 }])
  })
})
