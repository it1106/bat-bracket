import { promises as fs } from 'fs'
import path from 'path'
import type { Lang } from '@/lib/i18n'
import { normalizeClub } from './alerts'
import type { AlertTier, FollowTarget, PlayerFollow, PushFollow, PushKeys, PushSubscriptionRecord } from './types'
import { isEverywhere } from './follows'
import type { DeviceOs } from './user-agent'

// The devices that asked for match alerts and what each one follows. One JSON
// file, held in memory while it is unchanged on disk, rewritten whole on every
// change through a single chain so writes within a worker never interleave. Bounded: MAX_DEVICES records of at
// most MAX_PLAYER_FOLLOWS + MAX_CLUB_FOLLOWS follows each.

export const MAX_PLAYER_FOLLOWS = 50
export const MAX_CLUB_FOLLOWS = 10
export const MAX_DEVICES = 5000
export const STALE_DAYS = 60
const TOUCH_EVERY_MS = 86_400_000

export type FollowResult =
  | { ok: true; follows: PushFollow[] }
  | { ok: false; reason: 'player-limit' | 'club-limit' | 'device-limit' }

export type SiteResult =
  | { ok: true; follows: PushFollow[]; site: boolean }
  | { ok: false; reason: 'device-limit' }

// Kept on globalThis: Next builds the watcher (instrumentation) and the API
// routes as separate copies of this module in the same process. With a copy of
// the state each, they would write over one another; with one state and one
// chain they take turns. The same reason as lib/bat-fetch-stats.ts.
interface StoreState {
  root: string
  records: Map<string, PushSubscriptionRecord> | null
  /** The file's modified time when it was last read or written here. Another
   *  worker's write changes it, and the next use reads the file again. */
  readMtimeMs: number | null
  chain: Promise<unknown>
  /** Makes every temp file name its own, whoever writes it. */
  writes: number
}

const g = globalThis as typeof globalThis & { __batmatchPushStore?: StoreState }
const state: StoreState = (g.__batmatchPushStore ??= {
  root: path.join(process.cwd(), '.cache', 'push'),
  records: null,
  readMtimeMs: null,
  chain: Promise.resolve(),
  writes: 0,
})

export function __setPushRootForTesting(dir: string): void {
  state.root = dir
  state.records = null
  state.readMtimeMs = null
  state.chain = Promise.resolve()
}

const file = () => path.join(state.root, 'subscriptions.json')

function isRecord(v: unknown): v is PushSubscriptionRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  const keys = r.keys as Record<string, unknown> | undefined
  return typeof r.endpoint === 'string' && !!keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string' && Array.isArray(r.follows)
}

const mtimeOf = async (): Promise<number | null> => {
  try { return (await fs.stat(file())).mtimeMs } catch { return null }
}

async function load(): Promise<Map<string, PushSubscriptionRecord>> {
  // With two workers, a follow can land on the one that is not running the
  // watcher. Each worker therefore trusts its copy only while the file is the
  // one it last read or wrote.
  const mtime = await mtimeOf()
  if (state.records && mtime === state.readMtimeMs) return state.records
  state.readMtimeMs = mtime
  const map = new Map<string, PushSubscriptionRecord>()
  try {
    const parsed = JSON.parse(await fs.readFile(file(), 'utf8')) as { records?: unknown }
    for (const r of Array.isArray(parsed.records) ? parsed.records : []) {
      if (isRecord(r)) map.set(r.endpoint, r)
    }
  } catch (err) {
    // Missing is normal. Unreadable or half-written: start from empty; the
    // next write replaces the file.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] subscriptions unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
  }
  state.records = map
  return map
}

async function save(map: Map<string, PushSubscriptionRecord>): Promise<void> {
  const tmp = `${file()}.tmp.${process.pid}.${++state.writes}`
  await fs.mkdir(state.root, { recursive: true })
  await fs.writeFile(tmp, JSON.stringify({ version: 1, records: Array.from(map.values()) }), 'utf8')
  await fs.rename(tmp, file())
  state.readMtimeMs = await mtimeOf()
}

/** Runs one change at a time over the loaded map, and writes it when asked. */
function change<T>(fn: (map: Map<string, PushSubscriptionRecord>) => { value: T; dirty: boolean }): Promise<T> {
  const run = state.chain.then(async () => {
    let map = await load()
    let result = fn(map)
    if (result.dirty) {
      // Another worker may have written between the read and now. If so, take
      // its file and make the change again on top of it, so neither is lost.
      if ((await mtimeOf()) !== state.readMtimeMs) {
        map = await load()
        result = fn(map)
      }
      if (result.dirty) await save(map)
    }
    return result.value
  })
  state.chain = run.catch(() => undefined)
  return run
}

function sameTarget(f: PushFollow, t: FollowTarget): boolean {
  if (f.kind !== t.kind) return false
  // A player followed everywhere is matched on the name key alone: the follow
  // names no tournament, and the local id it was made from means nothing
  // outside the one it came from.
  if (t.kind === 'player' && t.scope === 'everywhere') return isEverywhere(f) && (f as PlayerFollow).slug === t.slug
  if (isEverywhere(f)) return false
  if (f.tournamentId !== t.tournamentId.toUpperCase()) return false
  if (f.kind === 'player' && t.kind === 'player') return f.playerId === t.playerId
  if (f.kind === 'club' && t.kind === 'club') return normalizeClub(f.clubName) === normalizeClub(t.clubName)
  return false
}

/** Writes the tier a target asks for onto a follow. `full` is what a follow
 *  with no tier already is, so it is stored as the absence of one: the file
 *  stays the size it was, and a record written before tiers reads exactly as
 *  one that asked for everything. */
function setTier(follow: PushFollow, tier: AlertTier | undefined): void {
  if (follow.kind !== 'player') return
  if (tier === 'result') follow.tier = 'result'
  else delete follow.tier
}

export async function listRecords(): Promise<PushSubscriptionRecord[]> {
  return change((map) => ({ value: Array.from(map.values()), dirty: false }))
}

export async function getRecord(endpoint: string): Promise<PushSubscriptionRecord | null> {
  return change((map) => ({ value: map.get(endpoint) ?? null, dirty: false }))
}

export async function addFollow(
  sub: { endpoint: string; keys: PushKeys },
  lang: Lang,
  target: FollowTarget,
  now: number,
  os: DeviceOs = '',
): Promise<FollowResult> {
  return change<FollowResult>((map) => {
    const at = new Date(now).toISOString()
    const existing = map.get(sub.endpoint)
    if (!existing && map.size >= MAX_DEVICES) return { value: { ok: false, reason: 'device-limit' }, dirty: false }
    const rec: PushSubscriptionRecord = existing ?? { endpoint: sub.endpoint, keys: sub.keys, lang, follows: [], createdAt: at, lastSeenAt: at }

    const already = rec.follows.find((f) => sameTarget(f, target))
    if (already) {
      // Following again is how the bell changes a follow's tier: the follow
      // stays the one it was, with the date it was first made.
      if (target.kind === 'player') setTier(already, target.tier)
    } else {
      const count = rec.follows.filter((f) => f.kind === target.kind).length
      if (target.kind === 'player' && count >= MAX_PLAYER_FOLLOWS) return { value: { ok: false, reason: 'player-limit' }, dirty: false }
      if (target.kind === 'club' && count >= MAX_CLUB_FOLLOWS) return { value: { ok: false, reason: 'club-limit' }, dirty: false }
      const added: PushFollow =
        target.kind === 'club'
          ? { kind: 'club', tournamentId: target.tournamentId.toUpperCase(), clubName: target.clubName.replace(/\s+/g, ' ').trim(), addedAt: at }
          : target.scope === 'everywhere'
            // No tournament and no local id: what this follow is matched on
            // is the name key, in whichever tournament the player turns up.
            ? { kind: 'player', tournamentId: '', playerId: '', slug: target.slug, playerName: target.playerName, addedAt: at }
            : { kind: 'player', tournamentId: target.tournamentId.toUpperCase(), playerId: target.playerId, playerName: target.playerName ?? '', addedAt: at }
      if (target.kind === 'player') setTier(added, target.tier)
      rec.follows.push(added)
    }
    rec.keys = sub.keys
    rec.lang = lang
    rec.lastSeenAt = at
    if (os) rec.os = os
    map.set(rec.endpoint, rec)
    return { value: { ok: true, follows: rec.follows.slice() }, dirty: true }
  })
}

export async function removeFollow(endpoint: string, target: FollowTarget): Promise<PushFollow[]> {
  return change((map) => {
    const rec = map.get(endpoint)
    if (!rec) return { value: [], dirty: false }
    const kept = rec.follows.filter((f) => !sameTarget(f, target))
    if (kept.length === rec.follows.length) return { value: rec.follows.slice(), dirty: false }
    // A device with site news on stays: it is subscribed to the site, not to
    // this tournament.
    if (kept.length === 0 && !rec.site) map.delete(endpoint)
    else rec.follows = kept
    return { value: kept, dirty: true }
  })
}

/** Turns this device's site-news switch on or off. On is enough to create a
 *  record: unlike a follow, it names no tournament. Off removes the record
 *  when nothing else is left on it, exactly as unfollowing the last player
 *  does. */
export async function setSite(
  sub: { endpoint: string; keys: PushKeys },
  lang: Lang,
  on: boolean,
  now: number,
  os: DeviceOs = '',
): Promise<SiteResult> {
  return change<SiteResult>((map) => {
    const at = new Date(now).toISOString()
    const existing = map.get(sub.endpoint)
    // Switching off a device the server never had is already true.
    if (!existing && !on) return { value: { ok: true, follows: [], site: false }, dirty: false }
    if (!existing && map.size >= MAX_DEVICES) return { value: { ok: false, reason: 'device-limit' }, dirty: false }
    const rec: PushSubscriptionRecord =
      existing ?? { endpoint: sub.endpoint, keys: sub.keys, lang, follows: [], createdAt: at, lastSeenAt: at }

    if (!on && rec.follows.length === 0) {
      map.delete(rec.endpoint)
      return { value: { ok: true, follows: [], site: false }, dirty: true }
    }
    if (on) rec.site = true
    else delete rec.site
    rec.keys = sub.keys
    rec.lang = lang
    rec.lastSeenAt = at
    if (os) rec.os = os
    map.set(rec.endpoint, rec)
    return { value: { ok: true, follows: rec.follows.slice(), site: !!rec.site }, dirty: true }
  })
}

/** Removes every follow in the given tournaments, on every device. A device
 *  left following nothing goes too, as it does on unfollowing its last one.
 *  Resolves to the number of follows removed. */
export async function removeFollowsIn(tournamentIds: string[]): Promise<number> {
  const ids = new Set(tournamentIds.map((id) => id.toUpperCase()))
  return change((map) => {
    let removed = 0
    for (const [endpoint, rec] of Array.from(map)) {
      const kept = rec.follows.filter((f) => !ids.has(f.tournamentId.toUpperCase()))
      if (kept.length === rec.follows.length) continue
      removed += rec.follows.length - kept.length
      if (kept.length === 0 && !rec.site) map.delete(endpoint)
      else rec.follows = kept
    }
    return { value: removed, dirty: removed > 0 }
  })
}

export async function touchRecord(endpoint: string, now: number, os: DeviceOs = ''): Promise<{ follows: PushFollow[]; site: boolean } | null> {
  return change((map) => {
    const rec = map.get(endpoint)
    if (!rec) return { value: null, dirty: false }
    // A device that moved to another OS, or one first seen before this was
    // kept. Worth a write on its own, whatever the date throttle below says.
    const osChanged = !!os && rec.os !== os
    if (osChanged) rec.os = os
    // Every page load of a subscribed device comes through here. The date only
    // feeds the 60-day prune, so once a day is often enough to write it.
    const seen = Date.parse(rec.lastSeenAt)
    const value = { follows: rec.follows.slice(), site: !!rec.site }
    if (!Number.isNaN(seen) && now - seen < TOUCH_EVERY_MS) return { value, dirty: osChanged }
    rec.lastSeenAt = new Date(now).toISOString()
    return { value, dirty: true }
  })
}

export async function removeRecord(endpoint: string): Promise<void> {
  return change((map) => ({ value: undefined, dirty: map.delete(endpoint) }))
}

export async function pruneStale(now: number): Promise<number> {
  return change((map) => {
    const cutoff = now - STALE_DAYS * 86_400_000
    let removed = 0
    for (const [endpoint, rec] of Array.from(map)) {
      const seen = Date.parse(rec.lastSeenAt)
      if (Number.isNaN(seen) || seen < cutoff) { map.delete(endpoint); removed++ }
    }
    return { value: removed, dirty: removed > 0 }
  })
}
