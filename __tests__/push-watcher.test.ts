import { runWatcherTick, __resetWatcherForTesting, type WatcherDeps } from '@/lib/push/watcher'
import type { PushFollow, PushPayload, PushSubscriptionRecord } from '@/lib/push/types'
import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from '@/lib/types'
import type { SendResult } from '@/lib/push/sender'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const TID2 = 'BBBBBBBB-0000-0000-0000-000000000002'
const DAY = '2026-10-09'
const P = (id: string): MatchPlayer => ({ name: `P${id}`, playerId: id })
const m = (a: string, b: string, over: Partial<MatchEntry> = {}): MatchEntry => ({
  draw: 'BS U15', drawNum: '21', round: 'Round of 32', team1: [P(a)], team2: [P(b)],
  winner: null, scores: [], court: 'Court 1', walkover: false, retired: false, nowPlaying: false, ...over,
})
const day = (...matches: MatchEntry[]): MatchScheduleGroup[] => [{ type: 'time', time: '9:00', matches }]
const follow = (playerId: string, tournamentId = TID): PushFollow => ({ kind: 'player', tournamentId, playerId, playerName: `P${playerId}`, addedAt: '' })
const device = (name: string, follows: PushFollow[]): PushSubscriptionRecord => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p', auth: 'a' }, lang: 'en', follows, createdAt: '', lastSeenAt: '',
})
const QUEUE = () => day(m('90', '91', { winner: 1 }), m('1', '2'), m('3', '4'), m('5', '6'), m('7', '8'))

function world(over: Partial<WatcherDeps> & { records?: PushSubscriptionRecord[]; days?: Record<string, MatchScheduleGroup[] | null>; results?: Record<string, SendResult> } = {}) {
  const sent = new Set<string>()
  const pushes: Array<{ to: string; payload: PushPayload }> = []
  const removed: string[] = []
  const fetched: string[] = []
  const deps: WatcherDeps = {
    now: () => Date.UTC(2026, 9, 9, 3, 15),
    todayIso: () => DAY,
    isBatDown: () => false,
    listRecords: async () => over.records ?? [],
    isWatchable: () => true,
    fetchDay: async (tid) => { fetched.push(tid); return (over.days ?? { [TID]: QUEUE() })[tid] ?? null },
    clubOf: async () => () => undefined,
    hasSent: (k) => sent.has(k),
    markSent: async (keys) => { keys.forEach((k) => sent.add(k)) },
    send: async (record, payload) => {
      const name = record.endpoint.split('/').pop()!
      pushes.push({ to: name, payload })
      return over.results?.[name] ?? 'ok'
    },
    removeRecord: async (endpoint) => { removed.push(endpoint.split('/').pop()!) },
    record: () => {},
    ...over,
  }
  return { deps, sent, pushes, removed, fetched }
}

beforeEach(() => __resetWatcherForTesting())

describe('runWatcherTick', () => {
  it('sends a due alert once, however many ticks follow', async () => {
    const w = world({ records: [device('a', [follow('1')])] })
    expect(await runWatcherTick(w.deps)).toEqual({ sent: 1, failed: 0, gone: 0 })
    expect(w.pushes).toHaveLength(1)
    expect(w.pushes[0].payload.title).toBe('Up next')
    await runWatcherTick(w.deps)
    await runWatcherTick(w.deps)
    expect(w.pushes).toHaveLength(1)
  })

  it('does nothing, and fetches nothing, with nobody following', async () => {
    const w = world({ records: [] })
    expect(await runWatcherTick(w.deps)).toEqual({ sent: 0, failed: 0, gone: 0 })
    expect(w.fetched).toEqual([])
  })

  it('sends nothing and fetches nothing while BAT is down', async () => {
    const w = world({ records: [device('a', [follow('1')])], isBatDown: () => true })
    await runWatcherTick(w.deps)
    expect(w.pushes).toEqual([])
    expect(w.fetched).toEqual([])
  })

  it('fetches each followed tournament once, whoever follows it', async () => {
    const w = world({
      records: [device('a', [follow('1'), follow('3')]), device('b', [follow('1'), follow('9', TID2)])],
      days: { [TID]: QUEUE(), [TID2]: null },
    })
    await runWatcherTick(w.deps)
    expect(w.fetched.slice().sort()).toEqual([TID, TID2])
  })

  it('never asks for a tournament that is finished or that the site does not list', async () => {
    const w = world({
      records: [device('a', [follow('1'), follow('1', TID2)])],
      days: { [TID]: QUEUE(), [TID2]: day(m('90', '91', { winner: 1 }), m('1', '2')) },
      isWatchable: (tid) => tid === TID,
    })
    expect((await runWatcherTick(w.deps)).sent).toBe(1)
    expect(w.fetched).toEqual([TID])
  })

  it('skips a tournament with no schedule today and carries on with the others', async () => {
    const w = world({
      records: [device('a', [follow('1'), follow('1', TID2)])],
      days: { [TID2]: day(m('90', '91', { winner: 1 }), m('1', '2')), [TID]: null },
    })
    expect((await runWatcherTick(w.deps)).sent).toBe(1)
  })

  it('carries on when one tournament\'s schedule throws', async () => {
    const w = world({ records: [device('a', [follow('1'), follow('1', TID2)])] })
    w.deps.fetchDay = async (tid) => { if (tid === TID) throw new Error('boom'); return day(m('90', '91', { winner: 1 }), m('1', '2')) }
    expect((await runWatcherTick(w.deps)).sent).toBe(1)
  })

  it('removes a device the push service no longer knows, and only that one', async () => {
    const w = world({ records: [device('gone', [follow('1')]), device('fine', [follow('1')])], results: { gone: 'gone' } })
    expect(await runWatcherTick(w.deps)).toEqual({ sent: 1, failed: 0, gone: 1 })
    expect(w.removed).toEqual(['gone'])
    expect(w.pushes.map((p) => p.to).sort()).toEqual(['fine', 'gone'])
  })

  it('one device failing does not stop the others, and is retried next tick', async () => {
    const w = world({ records: [device('bad', [follow('1')]), device('good', [follow('1')])], results: { bad: 'failed' } })
    expect(await runWatcherTick(w.deps)).toEqual({ sent: 1, failed: 1, gone: 0 })
    await runWatcherTick(w.deps)
    expect(w.pushes.filter((p) => p.to === 'bad')).toHaveLength(2)
    expect(w.pushes.filter((p) => p.to === 'good')).toHaveLength(1)
  })

  it('gives up on an alert after three failed ticks', async () => {
    const w = world({ records: [device('bad', [follow('1')])], results: { bad: 'failed' } })
    for (let i = 0; i < 5; i++) await runWatcherTick(w.deps)
    expect(w.pushes).toHaveLength(3)
  })

  it('a send that throws counts as a failure and does not stop the tick', async () => {
    const w = world({ records: [device('bad', [follow('1')]), device('good', [follow('1')])] })
    const send = w.deps.send
    w.deps.send = async (record, payload) => { if (record.endpoint.endsWith('bad')) throw new Error('boom'); return send(record, payload) }
    expect(await runWatcherTick(w.deps)).toEqual({ sent: 1, failed: 1, gone: 0 })
  })

  it('sends one or two alerts singly', async () => {
    const w = world({ records: [device('a', [follow('1'), follow('3')])] })
    await runWatcherTick(w.deps)
    expect(w.pushes.map((p) => p.payload.title).sort()).toEqual(['About 1 match away', 'Up next'])
  })

  it('bundles more than two for one device into a single notification, and settles them all', async () => {
    const w = world({ records: [device('a', [follow('1'), follow('3'), follow('5'), follow('7')])] })
    expect((await runWatcherTick(w.deps)).sent).toBe(1)
    expect(w.pushes).toHaveLength(1)
    expect(w.pushes[0].payload.title).toBe('4 matches coming up')
    expect(w.pushes[0].payload.body.split('\n')[0]).toContain('P1')
    await runWatcherTick(w.deps)
    expect(w.pushes).toHaveLength(1)
  })

  it('bundles per device and per tournament, not across them', async () => {
    const w = world({
      records: [device('a', [follow('1'), follow('3'), follow('1', TID2)]), device('b', [follow('5')])],
      days: { [TID]: QUEUE(), [TID2]: day(m('90', '91', { winner: 1 }), m('1', '2')) },
    })
    await runWatcherTick(w.deps)
    expect(w.pushes.filter((p) => p.to === 'a')).toHaveLength(3)
    expect(w.pushes.filter((p) => p.to === 'b')).toHaveLength(1)
  })

  it('uses the tournament\'s club map', async () => {
    const clubFollow: PushFollow = { kind: 'club', tournamentId: TID, clubName: 'Red Club', addedAt: '' }
    const w = world({ records: [device('a', [clubFollow])] })
    w.deps.clubOf = async () => (id) => (id === '3' ? 'Red Club' : undefined)
    await runWatcherTick(w.deps)
    expect(w.pushes).toHaveLength(1)
    expect(w.pushes[0].payload.body).toContain('P3')
  })

  it('reports each result to the day\'s counts', async () => {
    const seen: string[] = []
    const w = world({ records: [device('a', [follow('1')]), device('gone', [follow('1')])], results: { gone: 'gone' } })
    w.deps.record = (result, dayIso) => { seen.push(`${result}:${dayIso}`) }
    await runWatcherTick(w.deps)
    expect(seen.sort()).toEqual([`gone:${DAY}`, `ok:${DAY}`])
  })
})
