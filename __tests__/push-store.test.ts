import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  addFollow, removeFollow, getRecord, listRecords, touchRecord, removeRecord, pruneStale, removeFollowsIn,
  MAX_PLAYER_FOLLOWS, MAX_CLUB_FOLLOWS, STALE_DAYS, __setPushRootForTesting,
} from '@/lib/push/store'
import type { FollowTarget } from '@/lib/push/types'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const sub = (name: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p', auth: 'a' } })
const player = (id: string, tournamentId = TID): FollowTarget => ({ kind: 'player', tournamentId, playerId: id, playerName: `P${id}` })
const club = (clubName: string): FollowTarget => ({ kind: 'club', tournamentId: TID, clubName })
const T0 = Date.UTC(2026, 9, 9)
const DAY = 86_400_000

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'push-store-'))
  __setPushRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('push store', () => {
  it('starts empty', async () => {
    expect(await listRecords()).toEqual([])
    expect(await getRecord(sub('a').endpoint)).toBeNull()
  })

  it('creates a record on the first follow and stores the id upper-case', async () => {
    const r = await addFollow(sub('a'), 'th', player('1', TID.toLowerCase()), T0)
    expect(r.ok && r.follows).toEqual([{ kind: 'player', tournamentId: TID, playerId: '1', playerName: 'P1', addedAt: new Date(T0).toISOString() }])
    const rec = (await getRecord(sub('a').endpoint))!
    expect(rec.lang).toBe('th')
    expect(rec.keys).toEqual({ p256dh: 'p', auth: 'a' })
    expect(rec.createdAt).toBe(new Date(T0).toISOString())
  })

  it('does not add the same player or club twice', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('a'), 'en', player('1'), T0 + 5)
    await addFollow(sub('a'), 'en', club('Red Club'), T0)
    const r = await addFollow(sub('a'), 'en', club('  red   club '), T0)
    expect(r.ok && r.follows).toHaveLength(2)
  })

  it('updates the keys and language when the device follows again', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow({ endpoint: sub('a').endpoint, keys: { p256dh: 'p2', auth: 'a2' } }, 'th', player('2'), T0 + DAY)
    const rec = (await getRecord(sub('a').endpoint))!
    expect(rec.keys.p256dh).toBe('p2')
    expect(rec.lang).toBe('th')
    expect(rec.lastSeenAt).toBe(new Date(T0 + DAY).toISOString())
    expect(rec.createdAt).toBe(new Date(T0).toISOString())
  })

  it('unfollows, and deletes the record with the last follow', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('a'), 'en', club('Red Club'), T0)
    expect(await removeFollow(sub('a').endpoint, club('RED CLUB'))).toHaveLength(1)
    expect(await removeFollow(sub('a').endpoint, { kind: 'player', tournamentId: TID.toLowerCase(), playerId: '1' })).toEqual([])
    expect(await getRecord(sub('a').endpoint)).toBeNull()
  })

  it('unfollowing something not followed, or from an unknown device, changes nothing', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    expect(await removeFollow(sub('a').endpoint, player('2'))).toHaveLength(1)
    expect(await removeFollow(sub('zzz').endpoint, player('1'))).toEqual([])
  })

  it('refuses past the player and club limits', async () => {
    for (let i = 0; i < MAX_PLAYER_FOLLOWS; i++) await addFollow(sub('a'), 'en', player(String(i)), T0)
    expect(await addFollow(sub('a'), 'en', player('999'), T0)).toEqual({ ok: false, reason: 'player-limit' })
    for (let i = 0; i < MAX_CLUB_FOLLOWS; i++) await addFollow(sub('a'), 'en', club(`Club ${i}`), T0)
    expect(await addFollow(sub('a'), 'en', club('One More'), T0)).toEqual({ ok: false, reason: 'club-limit' })
    // a follow it already has is still fine at the limit
    expect((await addFollow(sub('a'), 'en', player('0'), T0)).ok).toBe(true)
  })

  it('touch refreshes last-seen and returns the follows; null for a stranger', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    expect(await touchRecord(sub('a').endpoint, T0 + 2 * DAY)).toHaveLength(1)
    expect((await getRecord(sub('a').endpoint))!.lastSeenAt).toBe(new Date(T0 + 2 * DAY).toISOString())
    expect(await touchRecord(sub('nobody').endpoint, T0)).toBeNull()
  })

  it('removes one device and leaves the others', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('b'), 'en', player('1'), T0)
    await removeRecord(sub('a').endpoint)
    expect((await listRecords()).map((r) => r.endpoint)).toEqual([sub('b').endpoint])
  })

  it('prunes devices not seen for sixty days', async () => {
    await addFollow(sub('old'), 'en', player('1'), T0)
    await addFollow(sub('new'), 'en', player('1'), T0 + 30 * DAY)
    expect(await pruneStale(T0 + (STALE_DAYS + 1) * DAY)).toBe(1)
    expect((await listRecords()).map((r) => r.endpoint)).toEqual([sub('new').endpoint])
  })

  it('survives a restart: what was written is read back', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    __setPushRootForTesting(tmp) // drops the in-memory copy
    expect(await listRecords()).toHaveLength(1)
  })

  it('keeps every follow when many arrive at once', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => addFollow(sub(`d${i}`), 'en', player('1'), T0)))
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toHaveLength(20)
  })

  it('sees a follow another worker wrote, and keeps it through its own next change', async () => {
    await addFollow(sub('mine'), 'en', player('1'), T0)
    // another worker rewrites the file with one more device
    const onDisk = JSON.parse(await fs.readFile(path.join(tmp, 'subscriptions.json'), 'utf8'))
    onDisk.records.push({ endpoint: sub('theirs').endpoint, keys: { p256dh: 'p', auth: 'a' }, lang: 'en', follows: [{ kind: 'player', tournamentId: TID, playerId: '7', playerName: 'P7', addedAt: '' }], createdAt: '', lastSeenAt: new Date(T0).toISOString() })
    await fs.writeFile(path.join(tmp, 'subscriptions.json'), JSON.stringify(onDisk), 'utf8')
    // make sure the change shows in the file's modified time, whatever the clock's resolution
    const later = new Date(Date.now() + 5000)
    await fs.utimes(path.join(tmp, 'subscriptions.json'), later, later)
    expect((await listRecords()).map((r) => r.endpoint).sort()).toEqual([sub('mine').endpoint, sub('theirs').endpoint].sort())
    await addFollow(sub('mine'), 'en', player('2'), T0)
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toHaveLength(2)
  })

  it('starts from empty when the file is corrupt, and writes a good one over it', async () => {
    await fs.writeFile(path.join(tmp, 'subscriptions.json'), '{"version":1,"records":[{"endp', 'utf8')
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toEqual([])
    await addFollow(sub('a'), 'en', player('1'), T0)
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toHaveLength(1)
  })

  it('ignores records in the file that are not shaped like records', async () => {
    await fs.writeFile(path.join(tmp, 'subscriptions.json'), JSON.stringify({ version: 1, records: [{ endpoint: 5 }, null, 'x'] }), 'utf8')
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toEqual([])
  })
})

describe('push store loaded twice in one process', () => {
  // Next builds the watcher's code and the routes' code as separate copies of
  // this module; both must be the same store.
  it('two copies of the module share one set of records and do not trip over each other\'s writes', async () => {
    let other!: typeof import('@/lib/push/store')
    jest.isolateModules(() => { other = require('../lib/push/store') })
    expect(other.addFollow).not.toBe(addFollow)
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => addFollow(sub(`a${i}`), 'en', player('1'), T0)),
      ...Array.from({ length: 10 }, (_, i) => other.addFollow(sub(`b${i}`), 'en', player('1'), T0)),
    ])
    expect(await listRecords()).toHaveLength(20)
    expect(await other.listRecords()).toHaveLength(20)
    __setPushRootForTesting(tmp)
    expect(await listRecords()).toHaveLength(20)
    expect((await fs.readdir(tmp)).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})

describe('touchRecord', () => {
  const mtime = async () => (await fs.stat(path.join(tmp, 'subscriptions.json'))).mtimeMs

  it('does not rewrite the file for a device seen within the last day', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    const before = await mtime()
    expect(await touchRecord(sub('a').endpoint, T0 + 60_000)).toHaveLength(1)
    expect(await touchRecord(sub('a').endpoint, T0 + DAY - 1)).toHaveLength(1)
    expect(await mtime()).toBe(before)
    expect((await getRecord(sub('a').endpoint))!.lastSeenAt).toBe(new Date(T0).toISOString())
  })

  it('does write once a day has passed, which is what keeps the device from being pruned', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await touchRecord(sub('a').endpoint, T0 + DAY + 1)
    __setPushRootForTesting(tmp)
    expect((await getRecord(sub('a').endpoint))!.lastSeenAt).toBe(new Date(T0 + DAY + 1).toISOString())
  })
})

describe('removeFollowsIn', () => {
  const OTHER = 'BBBBBBBB-0000-0000-0000-000000000002'

  it('removes every follow in the given tournaments and leaves the rest', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('a'), 'en', club('Red Club'), T0)
    await addFollow(sub('a'), 'en', player('2', OTHER), T0)
    await addFollow(sub('b'), 'en', player('3', OTHER), T0)
    expect(await removeFollowsIn([TID.toLowerCase()])).toBe(2)
    expect((await getRecord(sub('a').endpoint))!.follows.map((f) => f.tournamentId)).toEqual([OTHER])
    expect((await getRecord(sub('b').endpoint))!.follows).toHaveLength(1)
  })

  it('drops a device left with nothing to follow, as unfollowing the last one does', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('b'), 'en', player('2', OTHER), T0)
    expect(await removeFollowsIn([TID])).toBe(1)
    expect(await getRecord(sub('a').endpoint)).toBeNull()
    expect(await listRecords()).toHaveLength(1)
  })

  it('writes nothing when there is nothing to remove', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    const before = (await fs.stat(path.join(tmp, 'subscriptions.json'))).mtimeMs
    expect(await removeFollowsIn([OTHER])).toBe(0)
    expect(await removeFollowsIn([])).toBe(0)
    expect((await fs.stat(path.join(tmp, 'subscriptions.json'))).mtimeMs).toBe(before)
  })
})
