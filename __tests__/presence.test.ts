import { PresenceStore, ONLINE_WINDOW_MS, isValidDeviceId } from '@/lib/presence'

// Keep the route tests off the real .cache/presence.json.
jest.mock('../lib/presence-persist', () => ({
  ensurePresenceLoaded: jest.fn(),
  schedulePresenceSave: jest.fn(),
}))

describe('PresenceStore', () => {
  it('counts each device once, however often it pings', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-aaaa', 1000)
    s.touch('device-bbbb', 2000)
    expect(s.count(2000)).toBe(2)
  })

  it('drops devices that stopped pinging after the online window', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-bbbb', 60_000)
    expect(s.count(ONLINE_WINDOW_MS)).toBe(2)
    expect(s.count(ONLINE_WINDOW_MS + 1)).toBe(1)
    expect(s.count(60_000 + ONLINE_WINDOW_MS + 1)).toBe(0)
  })

  it('keeps a device online when an old one re-pings after newer ones', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-bbbb', 10_000)
    s.touch('device-aaaa', 100_000) // re-ping moves it to newest
    expect(s.count(10_000 + ONLINE_WINDOW_MS + 1)).toBe(1)
  })
})

describe('PresenceStore online list', () => {
  it('lists the devices online right now, most recently seen first', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 1000)
    s.touch('device-bbbb', 2000)
    s.touch('device-aaaa', 3000)
    expect(s.online(3000)).toEqual([
      { id: 'device-aaaa', lastSeen: 3000 },
      { id: 'device-bbbb', lastSeen: 2000 },
    ])
  })

  it('leaves out devices that have dropped off', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-bbbb', 60_000)
    expect(s.online(ONLINE_WINDOW_MS + 1)).toEqual([{ id: 'device-bbbb', lastSeen: 60_000 }])
  })
})

describe('PresenceStore peak', () => {
  // 2026-10-02 12:00 in Bangkok (UTC+7).
  const NOON = Date.UTC(2026, 9, 2, 5, 0, 0)
  const MIN = 60_000

  it('remembers the highest count after devices drop off', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON)
    s.touch('device-bbbb', NOON)
    expect(s.count(NOON)).toBe(2)
    expect(s.count(NOON + 10 * MIN)).toBe(0)
    expect(s.peak(NOON + 10 * MIN)).toEqual({ day: '2026-10-02', count: 2, at: NOON })
  })

  it('keeps the time of the first moment the peak was reached', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON)
    s.count(NOON)
    s.touch('device-aaaa', NOON + MIN)
    s.count(NOON + MIN)
    expect(s.peak(NOON + MIN)).toEqual({ day: '2026-10-02', count: 1, at: NOON })
  })

  it('has no peak before anyone is seen', () => {
    const s = new PresenceStore()
    expect(s.peak(NOON)).toEqual({ day: '2026-10-02', count: 0, at: null })
  })

  it('starts a new peak at Bangkok midnight, from whoever is still online', () => {
    const s = new PresenceStore()
    const beforeMidnight = Date.UTC(2026, 9, 2, 16, 59, 30) // 23:59:30 Bangkok
    const afterMidnight = beforeMidnight + MIN // 00:00:30 Bangkok, Oct 3
    s.touch('device-cccc', beforeMidnight - 90_000) // drops off before 00:00:30
    s.touch('device-aaaa', beforeMidnight)
    s.touch('device-bbbb', beforeMidnight)
    expect(s.count(beforeMidnight)).toBe(3)
    expect(s.peak(afterMidnight)).toEqual({ day: '2026-10-03', count: 2, at: afterMidnight })
  })

  it('reports each new peak once, and not when the count merely repeats', () => {
    const seen: Array<[string, number, number]> = []
    const s = new PresenceStore({ onNewPeak: (day, count, at) => seen.push([day, count, at]) })
    s.touch('device-aaaa', NOON)
    s.count(NOON)
    s.count(NOON + 1000)
    s.touch('device-bbbb', NOON + 2000)
    s.count(NOON + 2000)
    expect(seen).toEqual([
      ['2026-10-02', 1, NOON],
      ['2026-10-02', 2, NOON + 2000],
    ])
  })
})

describe('PresenceStore users today', () => {
  const NOON = Date.UTC(2026, 9, 2, 5, 0, 0) // 12:00 Bangkok
  const MIN = 60_000

  it('counts every device seen today, including ones that have gone offline', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON)
    s.touch('device-bbbb', NOON)
    s.touch('device-aaaa', NOON + MIN)
    expect(s.count(NOON + 30 * MIN)).toBe(0)
    expect(s.users(NOON + 30 * MIN)).toBe(2)
  })

  it('starts again at Bangkok midnight, counting the first ping of the new day', () => {
    const ends: Array<[string, number, number]> = []
    const s = new PresenceStore({ onDayEnd: (day, users, peak) => ends.push([day, users, peak]) })
    const beforeMidnight = Date.UTC(2026, 9, 2, 16, 59, 30)
    s.touch('device-aaaa', beforeMidnight)
    s.touch('device-bbbb', beforeMidnight)
    s.count(beforeMidnight)
    s.touch('device-aaaa', beforeMidnight + MIN) // 00:00:30, Oct 3
    expect(s.users(beforeMidnight + MIN)).toBe(1)
    expect(ends).toEqual([['2026-10-02', 2, 2]])
  })

  it('round-trips the day through a snapshot', () => {
    const a = new PresenceStore()
    a.touch('device-aaaa', NOON)
    a.touch('device-bbbb', NOON)
    a.count(NOON)
    const snap = a.snapshot(NOON + MIN)
    expect(snap).toEqual({
      day: '2026-10-02',
      peak: { count: 2, at: NOON },
      ids: ['device-aaaa', 'device-bbbb'],
    })

    const b = new PresenceStore()
    b.touch('device-cccc', NOON + MIN)
    b.restore(snap, NOON + MIN)
    expect(b.users(NOON + MIN)).toBe(3)
    expect(b.peak(NOON + MIN)).toEqual({ day: '2026-10-02', count: 2, at: NOON })
    expect(b.count(NOON + MIN)).toBe(1) // restored devices are not online
  })

  it('ignores a snapshot from another day and drops junk ids', () => {
    const s = new PresenceStore()
    s.restore({ day: '2026-10-01', peak: { count: 9, at: 1 }, ids: ['device-aaaa'] }, NOON)
    expect(s.users(NOON)).toBe(0)
    expect(s.peak(NOON).count).toBe(0)
    s.restore({ day: '2026-10-02', peak: { count: 0, at: null }, ids: ['device-aaaa', 'bad id', 7 as unknown as string] }, NOON)
    expect(s.users(NOON)).toBe(1)
  })
})

describe('isValidDeviceId', () => {
  it('accepts UUIDs and the dev_ fallback, rejects junk', () => {
    expect(isValidDeviceId('3f2b8c1e-9a4d-4e5f-8b6c-1d2e3f4a5b6c')).toBe(true)
    expect(isValidDeviceId('dev_k3j4h5g6l7m8')).toBe(true)
    expect(isValidDeviceId('')).toBe(false)
    expect(isValidDeviceId('short')).toBe(false)
    expect(isValidDeviceId('x'.repeat(65))).toBe(false)
    expect(isValidDeviceId('bad id with spaces')).toBe(false)
    expect(isValidDeviceId(42)).toBe(false)
  })
})

describe('GET /api/presence', () => {
  it('reports the count and peak without registering the caller', async () => {
    const { GET } = await import('@/app/api/presence/route')
    const body = await (await GET()).json()
    expect(body.online).toBe(0)
    expect(body.peak).toEqual({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), count: 0, at: null })
    expect(body.users).toBe(0)
  })
})

describe('POST /api/presence', () => {
  it("returns today's peak alongside the online count", async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const { POST } = await import('@/app/api/presence/route')
    const res = await POST(
      new Request('http://localhost/api/presence', {
        method: 'POST',
        body: JSON.stringify({ id: 'device-aaaa' }),
      }),
    )
    expect(await res.json()).toEqual({ online: 1, peak: 1, users: 1 })
    log.mockRestore()
  })
})
