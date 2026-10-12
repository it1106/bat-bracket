import { runPublicationPass, __resetPublicationsForTesting, type PublicationDeps } from '@/lib/push/publications'
import { EMPTY_PUBLISHED, type PublishedState } from '@/lib/push/published-state'
import type { PushPayload, PushSubscriptionRecord } from '@/lib/push/types'
import type { SendResult } from '@/lib/push/sender'
import type { RecentSend } from '@/lib/push/recent-sends'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const TODAY = '2026-10-12'
const NOW = Date.UTC(2026, 9, 12, 4, 0)

const device = (name: string, over: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p', auth: 'a' },
  lang: 'en', follows: [], createdAt: '', lastSeenAt: '', site: true, ...over,
})
const seeded = (tournaments: PublishedState['tournaments'] = {}): PublishedState => ({ version: 1, seeded: true, tournaments })
const entry = (over = {}) => ({ name: 'THE MALL 2026', firstSeenAt: '', announced: true, draws: [], days: [], ...over })

function world(over: Partial<PublicationDeps> & {
  records?: PushSubscriptionRecord[]
  state?: PublishedState
  draws?: Record<string, Array<{ drawNum: string; name: string; entrantCount?: number }> | null>
  days?: Record<string, Array<{ dateIso: string; date?: string; hasMatches?: boolean }> | null>
  results?: Record<string, SendResult>
  probeDay?: PublicationDeps['probeDay']
  isLeader?: PublicationDeps['isLeader']
} = {}) {
  const pushes: Array<{ to: string; payload: PushPayload }> = []
  const saved: PublishedState[] = []
  const probed: string[] = []
  const removed: string[] = []
  const noted: RecentSend[] = []
  const deps: PublicationDeps = {
    now: () => NOW,
    todayIso: () => TODAY,
    isBatDown: () => false,
    listTournaments: async () => [{ id: TID, name: 'THE MALL 2026', done: false }],
    fetchDraws: async (id) => (over.draws ?? { [TID]: [] })[id] ?? null,
    probeBracket: async (id, drawNum) => { probed.push(`${id}:${drawNum}`) },
    fetchDays: async (id) => (over.days ?? { [TID]: [] })[id] ?? null,
    probeDay: async () => null,
    isLeader: () => true,
    loadState: async () => over.state ?? seeded(),
    saveState: async (s) => { saved.push(s) },
    listRecords: async () => over.records ?? [device('a')],
    send: async (record, payload) => {
      const name = record.endpoint.split('/').pop()!
      pushes.push({ to: name, payload })
      return over.results?.[name] ?? 'ok'
    },
    removeRecord: async (endpoint) => { removed.push(endpoint.split('/').pop()!) },
    record: () => {},
    noteSend: async (row) => { noted.push(row) },
    ...over,
  }
  return { deps, pushes, saved, probed, removed, noted }
}

beforeEach(() => __resetPublicationsForTesting())

describe('runPublicationPass', () => {
  it('sends one notification per tournament per kind and records the state first', async () => {
    const w = world({
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
      days: { [TID]: [{ dateIso: '2026-10-20', hasMatches: true }] },
    })
    expect(await runPublicationPass(w.deps)).toEqual({ publications: 2, sent: 2, failed: 0, gone: 0 })
    expect(w.pushes.map((p) => p.payload.title)).toEqual(['Draws are out', 'Schedule published'])
    expect(w.saved).toHaveLength(1)
    expect(w.saved[0].tournaments[TID]).toEqual(expect.objectContaining({ draws: ['1'], days: ['2026-10-20'] }))
  })

  it('gives each device its own language', async () => {
    const w = world({
      records: [device('en-dev'), device('th-dev', { lang: 'th' })],
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
    })
    await runPublicationPass(w.deps)
    expect(w.pushes.find((p) => p.to === 'en-dev')!.payload.title).toBe('Draws are out')
    expect(w.pushes.find((p) => p.to === 'th-dev')!.payload.title).toBe('สายการแข่งขันออกแล้ว')
  })

  it('ignores a device that has not switched site news on', async () => {
    const w = world({
      records: [device('a', { site: undefined })],
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
    })
    const r = await runPublicationPass(w.deps)
    expect(w.pushes).toEqual([])
    // Detection still advanced, so a device switching on later gets no backlog.
    expect(r.publications).toBe(1)
    expect(w.saved[0].tournaments[TID].draws).toEqual(['1'])
  })

  it('seeds silently on the first ever pass', async () => {
    const w = world({
      state: EMPTY_PUBLISHED,
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
      days: { [TID]: [{ dateIso: '2026-10-20', hasMatches: true }] },
    })
    expect(await runPublicationPass(w.deps)).toEqual({ publications: 0, sent: 0, failed: 0, gone: 0 })
    expect(w.pushes).toEqual([])
    expect(w.saved[0].seeded).toBe(true)
    expect(w.saved[0].tournaments[TID].draws).toEqual(['1'])
  })

  it('does nothing at all while BAT is down', async () => {
    const w = world({ isBatDown: () => true })
    expect(await runPublicationPass(w.deps)).toEqual({ publications: 0, sent: 0, failed: 0, gone: 0 })
    expect(w.saved).toEqual([])
  })

  it('skips the pass when the tournament list comes back empty but the state is not', async () => {
    const w = world({ listTournaments: async () => [], state: seeded({ [TID]: entry() }) })
    await runPublicationPass(w.deps)
    expect(w.saved).toEqual([])
  })

  it('leaves a finished tournament alone', async () => {
    const w = world({
      listTournaments: async () => [{ id: TID, name: 'THE MALL 2026', done: true }],
      state: EMPTY_PUBLISHED,
    })
    await runPublicationPass(w.deps)
    expect(w.saved[0].tournaments).toEqual({})
  })

  it('probes un-counted draws before deciding, so a cached zero cannot hide entries', async () => {
    let counted = false
    const w = world({
      state: seeded({ [TID]: entry() }),
      fetchDraws: async () => (counted
        ? [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }]
        : [{ drawNum: '1', name: 'BS U15', entrantCount: 0 }]),
      probeBracket: async () => { counted = true },
    })
    const r = await runPublicationPass(w.deps)
    expect(r.publications).toBe(1)
    expect(w.pushes[0].payload.body).toBe('THE MALL 2026 · BS U15')
  })

  it('announces 33 draws filling at once as one notification, not seven', async () => {
    const names = Array.from({ length: 33 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i + 1}` }))
    let filled = false
    const w = world({
      state: seeded({ [TID]: entry() }),
      fetchDraws: async () => names.map((d) => ({ ...d, entrantCount: filled ? 16 : 0 })),
      probeBracket: async () => { filled = true },
    })
    const first = await runPublicationPass(w.deps)
    expect(first.publications).toBe(1)
    expect(w.pushes).toHaveLength(1)
    expect(w.pushes[0].payload.body).toBe('THE MALL 2026 · D1, D2, D3, D4 +29 more')
    expect(w.saved[0].tournaments[TID].draws).toHaveLength(33)
    // Nothing is left over for the passes that follow.
    expect((await runPublicationPass({ ...w.deps, loadState: async () => w.saved[0] })).publications).toBe(0)
  })

  it('announces a new tournament with many draws once, with no bracket notice behind it', async () => {
    const w = world({
      state: seeded(),
      draws: { [TID]: Array.from({ length: 12 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i + 1}`, entrantCount: 16 })) },
    })
    const r = await runPublicationPass(w.deps)
    expect(r.publications).toBe(1)
    expect(w.pushes.map((p) => p.payload.title)).toEqual(['New tournament'])
    expect(w.saved[0].tournaments[TID].draws).toHaveLength(12)
  })

  it('writes nothing for a tournament whose draws could not be read', async () => {
    const w = world({
      state: seeded({ [TID]: entry({ draws: ['1'] }) }),
      draws: { [TID]: null },
      days: { [TID]: [{ dateIso: '2026-10-20', hasMatches: true }] },
    })
    await runPublicationPass(w.deps)
    expect(w.saved[0].tournaments[TID].draws).toEqual(['1'])
    expect(w.saved[0].tournaments[TID].days).toEqual(['2026-10-20'])
  })

  it('drops a device the push service no longer knows, and counts a failure', async () => {
    const w = world({
      records: [device('gone-dev'), device('bad-dev'), device('ok-dev')],
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
      results: { 'gone-dev': 'gone', 'bad-dev': 'failed' },
    })
    expect(await runPublicationPass(w.deps)).toEqual({ publications: 1, sent: 1, failed: 1, gone: 1 })
    expect(w.removed).toEqual(['gone-dev'])
  })

  it('writes a status-page row naming the tournament and the reason', async () => {
    const w = world({
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
    })
    await runPublicationPass(w.deps)
    expect(w.noted[0]).toEqual(expect.objectContaining({
      stage: 'bracket', result: 'ok', draw: 'THE MALL 2026', round: '', match: 'THE MALL 2026 · BS U15', via: 'site news',
    }))
  })
})

describe('runPublicationPass — the schedule day probe', () => {
  const futureDays = [
    { dateIso: '2026-10-11', date: '20261011' },
    { dateIso: '2026-10-20', date: '20261020' },
    { dateIso: '2026-10-21', date: '20261021' },
  ]

  it('asks each un-announced future day whether it has matches, and announces the ones that do', async () => {
    const asked: string[] = []
    const w = world({
      state: seeded({ [TID]: entry() }),
      days: { [TID]: futureDays },
      probeDay: async (_id, date) => { asked.push(date); return date === '20261020' },
    })
    const r = await runPublicationPass(w.deps)
    expect(asked).toEqual(['20261020', '20261021'])
    expect(r.publications).toBe(1)
    expect(w.pushes[0].payload.title).toBe('Schedule published')
    expect(w.pushes[0].payload.body).toBe('THE MALL 2026 · 20 Oct')
    expect(w.saved[0].tournaments[TID].days).toEqual(['2026-10-20'])
  })

  it('never asks about a day it has already announced', async () => {
    const asked: string[] = []
    const w = world({
      state: seeded({ [TID]: entry({ days: ['2026-10-20'] }) }),
      days: { [TID]: futureDays },
      probeDay: async (_id, date) => { asked.push(date); return false },
    })
    await runPublicationPass(w.deps)
    expect(asked).toEqual(['20261021'])
  })

  it('leaves a day unannounced when it could not be read', async () => {
    const w = world({
      state: seeded({ [TID]: entry() }),
      days: { [TID]: futureDays },
      probeDay: async () => null,
    isLeader: () => true,
    })
    expect((await runPublicationPass(w.deps)).publications).toBe(0)
    expect(w.saved[0].tournaments[TID].days).toEqual([])
  })

  it('asks about the nearest days first and no more than the cap in one pass', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ dateIso: `2026-11-0${i + 1}`, date: `202611 0${i + 1}`.replace(' ', '') }))
    const asked: string[] = []
    const w = world({
      state: seeded({ [TID]: entry() }),
      days: { [TID]: many },
      probeDay: async (_id, date) => { asked.push(date); return false },
    })
    await runPublicationPass(w.deps)
    expect(asked).toEqual(['20261101', '20261102', '20261103'])
  })
})

describe('runPublicationPass — the seed must leave nothing announceable behind', () => {
  const sevenDays = Array.from({ length: 7 }, (_, i) => ({ dateIso: `2026-11-0${i + 1}`, date: `2026110${i + 1}` }))
  const draws33 = Array.from({ length: 33 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i + 1}`, entrantCount: 16 }))

  it('seeds a tournament with 33 draws and 7 published days, then says nothing on the next pass', async () => {
    const w = world({
      state: EMPTY_PUBLISHED,
      draws: { [TID]: draws33 },
      days: { [TID]: sevenDays },
      probeDay: async () => true,
    })
    expect((await runPublicationPass(w.deps)).publications).toBe(0)
    expect(w.saved[0].tournaments[TID].days).toHaveLength(7)

    const second = world({
      state: w.saved[0],
      draws: { [TID]: draws33 },
      days: { [TID]: sevenDays },
      probeDay: async () => true,
    })
    expect((await runPublicationPass(second.deps)).publications).toBe(0)
    expect(second.pushes).toEqual([])
  })

  it('announces a whole schedule published at once as one notification', async () => {
    const w = world({
      state: seeded({ [TID]: entry() }),
      days: { [TID]: sevenDays },
      probeDay: async () => true,
    })
    const r = await runPublicationPass(w.deps)
    expect(r.publications).toBe(1)
    expect(w.pushes).toHaveLength(1)
    expect(w.pushes[0].payload.body).toBe('THE MALL 2026 · 1 Nov, 2 Nov, 3 Nov, 4 Nov +3 more')
    expect(w.saved[0].tournaments[TID].days).toHaveLength(7)
  })

  it('a brand-new tournament records every published day with its arrival notice, and nothing follows', async () => {
    const w = world({
      state: seeded(),
      days: { [TID]: sevenDays },
      probeDay: async () => true,
    })
    const r = await runPublicationPass(w.deps)
    expect(w.pushes.map((p) => p.payload.title)).toEqual(['New tournament'])
    expect(r.publications).toBe(1)
    expect(w.saved[0].tournaments[TID].days).toHaveLength(7)
  })

  it('does not let days with no matches block the days behind them for ever', async () => {
    // Three near tabs that never get matches, then a real one.
    const days = [
      { dateIso: '2026-11-01', date: '20261101' },
      { dateIso: '2026-11-02', date: '20261102' },
      { dateIso: '2026-11-03', date: '20261103' },
      { dateIso: '2026-11-04', date: '20261104' },
    ]
    let state = seeded({ [TID]: entry() })
    const asked: string[][] = []
    let announced = 0
    for (let pass = 0; pass < 3; pass++) {
      const round: string[] = []
      const w = world({
        state,
        days: { [TID]: days },
        probeDay: async (_id, date) => { round.push(date); return date === '20261104' },
      })
      const r = await runPublicationPass(w.deps)
      announced += r.publications
      asked.push(round)
      state = w.saved[0]
    }
    expect(asked.flat()).toContain('20261104')
    expect(announced).toBe(1)
    expect(state.tournaments[TID].days).toEqual(['2026-11-04'])
  })
})

describe('runPublicationPass — a read that failed is never a baseline', () => {
  it('records nothing for a tournament seen for the first time whose draws could not be read', async () => {
    const w = world({
      state: seeded(),
      draws: { [TID]: null },
      days: { [TID]: [] },
    })
    expect((await runPublicationPass(w.deps)).publications).toBe(0)
    expect(w.pushes).toEqual([])
    expect(w.saved[0]?.tournaments[TID]).toBeUndefined()
  })

  it('records nothing for a first sighting whose schedule could not be read', async () => {
    const w = world({ state: seeded(), draws: { [TID]: [] }, days: { [TID]: null } })
    await runPublicationPass(w.deps)
    expect(w.saved[0]?.tournaments[TID]).toBeUndefined()
  })

  it('announces the tournament once the reads succeed, with its draws folded in', async () => {
    const first = world({ state: seeded(), draws: { [TID]: null }, days: { [TID]: [] } })
    await runPublicationPass(first.deps)
    const w = world({
      state: first.saved[0],
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
      days: { [TID]: [] },
    })
    const r = await runPublicationPass(w.deps)
    expect(w.pushes.map((p) => p.payload.title)).toEqual(['New tournament'])
    expect(r.publications).toBe(1)
    expect(w.saved[0].tournaments[TID].draws).toEqual(['1'])
  })
})

describe('runPublicationPass — it stops when it is no longer the leader or BAT goes down', () => {
  it('sends nothing and records nothing once the lease has moved', async () => {
    let leader = true
    const w = world({
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
      isLeader: () => leader,
      probeBracket: async () => { leader = false },
      fetchDraws: async () => { leader = false; return [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] },
    })
    await runPublicationPass(w.deps)
    expect(w.pushes).toEqual([])
    expect(w.saved).toEqual([])
  })

  it('stops probing when BAT goes down mid-pass', async () => {
    let down = false
    const probed: string[] = []
    const w = world({
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: Array.from({ length: 5 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i}`, entrantCount: 0 })) },
      isBatDown: () => down,
      probeBracket: async (_id, drawNum) => { probed.push(drawNum); down = true },
    })
    await runPublicationPass(w.deps)
    expect(probed).toHaveLength(1)
    expect(w.saved).toEqual([])
  })
})

describe('runPublicationPass — a draw with no name', () => {
  it('never renders an empty item in the body', async () => {
    const w = world({
      state: seeded({ [TID]: entry() }),
      draws: { [TID]: [
        { drawNum: '1', name: '', entrantCount: 16 },
        { drawNum: '2', name: 'GS U15', entrantCount: 8 },
      ] },
    })
    await runPublicationPass(w.deps)
    expect(w.pushes[0].payload.body).toBe('THE MALL 2026 · GS U15')
  })
})
