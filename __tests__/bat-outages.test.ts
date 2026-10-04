import { OutageTracker, downMinutesByDay, outageKindOf } from '@/lib/bat-outages'

const T0 = Date.UTC(2026, 9, 4, 16, 31, 0) // 23:31 in Bangkok
const s = (seconds: number) => T0 + seconds * 1000

/** `count` requests answered `status` (null = no answer), 10 s apart from `from`. */
function feed(tracker: OutageTracker, status: number | null, count: number, from: number): number {
  let t = from
  for (let i = 0; i < count; i++, t += 10_000) tracker.note(status, t)
  return t
}

describe('outageKindOf', () => {
  it('sorts an answer into working, erroring, refusing or silent', () => {
    expect(outageKindOf(200)).toBeNull()
    expect(outageKindOf(404)).toBeNull() // BAT answered; the page just is not there
    expect(outageKindOf(500)).toBe('error')
    expect(outageKindOf(503)).toBe('error')
    expect(outageKindOf(403)).toBe('blocked')
    expect(outageKindOf(429)).toBe('blocked')
    expect(outageKindOf(null)).toBe('unreachable')
  })
})

describe('OutageTracker', () => {
  it('does not call a few failures an outage', () => {
    const tracker = new OutageTracker()
    feed(tracker, 500, 4, s(0))
    tracker.note(200, s(60))
    expect(tracker.current()).toBeNull()
    expect(tracker.list(10)).toEqual([])
  })

  it('does not call one burst of simultaneous failures an outage', () => {
    const tracker = new OutageTracker()
    for (let i = 0; i < 20; i++) tracker.note(null, s(0) + i)
    expect(tracker.current()).toBeNull()
  })

  it('opens an outage at the first failure of a sustained run', () => {
    const tracker = new OutageTracker()
    tracker.note(200, s(-10))
    feed(tracker, 500, 6, s(0))
    expect(tracker.current()).toEqual({ start: s(0), end: null, kind: 'error', detail: 'HTTP 500', failed: 6 })
  })

  it('closes it at the first of three answers in a row', () => {
    const tracker = new OutageTracker()
    const t = feed(tracker, 500, 6, s(0))
    feed(tracker, 200, 2, t)
    expect(tracker.current()).not.toBeNull()
    tracker.note(200, t + 20_000)
    expect(tracker.current()).toBeNull()
    expect(tracker.list(10)).toEqual([{ start: s(0), end: t, kind: 'error', detail: 'HTTP 500', failed: 6 }])
  })

  it('stays open through a stray answer in the middle', () => {
    const tracker = new OutageTracker()
    let t = feed(tracker, 500, 6, s(0))
    t = feed(tracker, 200, 2, t)
    feed(tracker, 500, 3, t)
    expect(tracker.current()).toMatchObject({ start: s(0), end: null, failed: 9 })
  })

  it('names the outage after the failure seen most', () => {
    const tracker = new OutageTracker()
    tracker.note(null, s(0))
    feed(tracker, 500, 8, s(10))
    expect(tracker.current()).toMatchObject({ kind: 'error', detail: 'HTTP 500' })

    const silent = new OutageTracker()
    feed(silent, null, 6, s(0))
    expect(silent.current()).toMatchObject({ kind: 'unreachable', detail: 'no answer' })

    const refused = new OutageTracker()
    feed(refused, 403, 6, s(0))
    expect(refused.current()).toMatchObject({ kind: 'blocked', detail: 'HTTP 403' })
  })

  it('lists outages newest first, the open one included', () => {
    const tracker = new OutageTracker()
    let t = feed(tracker, 500, 6, s(0))
    t = feed(tracker, 200, 3, t)
    feed(tracker, null, 6, t + 600_000)
    expect(tracker.list(10).map((o) => o.kind)).toEqual(['unreachable', 'error'])
    expect(tracker.list(1)).toHaveLength(1)
  })

  it('carries an open outage across a restart', () => {
    const tracker = new OutageTracker()
    const t = feed(tracker, 500, 6, s(0))
    const next = new OutageTracker()
    next.restore(JSON.parse(JSON.stringify(tracker.snapshot())))
    expect(next.current()).toMatchObject({ start: s(0), failed: 6 })
    feed(next, 200, 3, t)
    expect(next.current()).toBeNull()
    expect(next.list(10)[0]).toMatchObject({ start: s(0), end: t })
    expect(next.since()).toBe(tracker.since())
  })

  it('says when BAT was last asked, and whether it looks down', () => {
    const tracker = new OutageTracker()
    tracker.note(200, s(0))
    expect(tracker.suspect()).toBe(false)
    tracker.note(500, s(30))
    expect(tracker.lastAskedAt()).toBe(s(30))
    expect(tracker.suspect()).toBe(true) // one failure: worth a closer look
    tracker.note(200, s(40))
    expect(tracker.suspect()).toBe(false)
    feed(tracker, 500, 6, s(50))
    expect(tracker.suspect()).toBe(true)
  })

  it('forgets outages older than it is asked to keep', () => {
    const tracker = new OutageTracker(1)
    let t = feed(tracker, 500, 6, s(0))
    t = feed(tracker, 200, 3, t)
    t = feed(tracker, 500, 6, t + 3 * 86_400_000)
    feed(tracker, 200, 3, t)
    expect(tracker.list(10)).toHaveLength(1)
  })

  it('ignores a saved file that is not what it wrote', () => {
    const tracker = new OutageTracker()
    tracker.restore({ outages: 'nope' })
    tracker.restore(null)
    expect(tracker.list(10)).toEqual([])
  })
})

describe('downMinutesByDay', () => {
  const day = (iso: string) => Date.parse(iso)

  it('adds up the minutes BAT was down on each Bangkok day', () => {
    const outages = [
      { start: day('2026-10-04T10:00:00+07:00'), end: day('2026-10-04T10:12:30+07:00'), kind: 'error' as const, detail: '', failed: 1 },
      { start: day('2026-10-04T15:00:00+07:00'), end: day('2026-10-04T15:05:00+07:00'), kind: 'error' as const, detail: '', failed: 1 },
    ]
    expect(downMinutesByDay(outages, day('2026-10-05T00:00:00+07:00'))).toEqual({ '2026-10-04': 18 })
  })

  it('splits an outage that runs past midnight, and counts an open one up to now', () => {
    const outages = [
      { start: day('2026-10-04T23:31:00+07:00'), end: null, kind: 'error' as const, detail: '', failed: 1 },
    ]
    expect(downMinutesByDay(outages, day('2026-10-05T00:20:00+07:00')))
      .toEqual({ '2026-10-04': 29, '2026-10-05': 20 })
  })
})
