# Publication Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device can switch on one site-wide notification and be told by web push when a tournament is newly listed, when its draws arrive with players in them, and when its playing days appear.

**Architecture:** A publication pass inside the existing push watcher, on the same leader lease but behind its own in-flight flag, reads the listed tournaments and their draws and schedule days through the app's own cached API routes, diffs them against an append-only disk state (`.cache/push/published.json`), writes the state, then sends one notification per tournament per kind to every device whose record has `site: true`. Detection is a pure function; everything that touches disk, the network or the push service is injected.

**Tech Stack:** Next 14 (App Router), TypeScript, Jest (`next/jest`, `testEnvironment: node`, jsdom per-file via docblock), `web-push`, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-publication-alerts-design.md`

## Global Constraints

- **Never fetch BAT directly.** Every read goes through the app's own routes (`/api/draws`, `/api/matches`, `/api/bracket`) so it shares the cache with visitors — the reason `makeFetchDay` exists in `lib/push/watcher.ts`.
- **`entrantCount === undefined` means "not counted", never zero** (`lib/bracket-state.ts`). It must never fire a publication and never be recorded as announced.
- **The published state is append-only.** A draw number or date, once recorded, is never removed; only a whole tournament entry is pruned (not listed and `firstSeenAt` older than 30 days).
- **First run seeds silently:** with no state file, record the full current snapshot and send nothing.
- **Detection runs even when no device has `site: true`.** State advances; only sending is conditional. Skipping detection would hand the next person who opts in a backlog.
- **State is written before the sends go out.** At-most-once delivery is the chosen semantics; a failure is logged, never retried.
- **The pass must never hold the watcher's `busy` flag.** Match alerts are time-critical.
- **Bracket probe cap: 5 draws per tournament per pass**, rotating (discovery's `BRACKET_GATE_PROBE_CAP`).
- **Thai and English**, chosen per device from `record.lang`. Thai strings are literals in `lib/push/text.ts`, as the existing payload builders do; UI labels go in `lib/i18n.ts`.
- **Tournament ids are upper-case GUIDs** everywhere in `lib/push`; `/api/draws` wants the id lower-cased.
- Test command: `npx jest <file> -t '<name>'`. Full run: `npm test`.

## Review Focus

Five things the spec implies, that no obvious happy-path test exercises, and that would bite a real person. Each has a test assigned to the task that owns the code.

1. **A corrupt or half-written `published.json`** — a reader that throws, or `JSON.parse` on a truncated file, must be treated as absent and therefore seed silently. Read as "no tournaments known" instead, every bracket already published is announced at once. → Task 2.
2. **Two devices with different languages in one pass** — the payload must be built per device from `record.lang`, not once per publication. A Thai device getting English copy is the visible failure. → Task 5.
3. **A tournament renamed upstream** — the notification body must use the name from the current snapshot, not the one stored when the tournament was first seen, or a renamed tournament announces under its old name forever. → Task 3.
4. **A draw list with repeated or empty draw numbers** — `/api/draws` stamps counts per draw and hides group draws, but nothing guarantees uniqueness. A duplicate must not name the same draw twice in one notification, and an empty `drawNum` must not be recorded. → Task 3.
5. **33 draws published at once** (THE MALL 2026 really did this) — the body must cap at four items with `+N more`, so the notification is readable and the payload stays small. → Task 4.

---

### Task 1: The `site` flag on the device record

**Files:**
- Modify: `lib/push/types.ts` (add `site` to `PushSubscriptionRecord`)
- Modify: `lib/push/store.ts` (`setSite`, lifecycle, `touchRecord` return shape)
- Modify: `app/api/push/state/route.ts:19` (call-site of `touchRecord`)
- Test: `__tests__/push-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PushSubscriptionRecord.site?: boolean`
  - `export type SiteResult = { ok: true; follows: PushFollow[]; site: boolean } | { ok: false; reason: 'device-limit' }`
  - `export async function setSite(sub: { endpoint: string; keys: PushKeys }, lang: Lang, on: boolean, now: number, os?: DeviceOs): Promise<SiteResult>`
  - `touchRecord(endpoint, now, os?)` now resolves `{ follows: PushFollow[]; site: boolean } | null` instead of `PushFollow[] | null`.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/push-store.test.ts`. Extend the existing import to include `setSite`.

```ts
  it('turns site news on for a device that follows nobody, and off again deletes it', async () => {
    const r = await setSite(sub('a'), 'th', true, T0)
    expect(r).toEqual({ ok: true, follows: [], site: true })
    const rec = (await getRecord(sub('a').endpoint))!
    expect(rec.site).toBe(true)
    expect(rec.lang).toBe('th')
    expect(rec.createdAt).toBe(new Date(T0).toISOString())

    expect(await setSite(sub('a'), 'th', false, T0 + 5)).toEqual({ ok: true, follows: [], site: false })
    expect(await getRecord(sub('a').endpoint)).toBeNull()
  })

  it('keeps the device when site news is on and its last follow goes', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await setSite(sub('a'), 'en', true, T0 + 1)
    expect(await removeFollow(sub('a').endpoint, player('1'))).toEqual([])
    const rec = (await getRecord(sub('a').endpoint))!
    expect(rec.site).toBe(true)
    expect(rec.follows).toEqual([])
  })

  it('keeps a site-news device when the finished-tournament sweep takes its follows', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await addFollow(sub('b'), 'en', player('2'), T0)
    await setSite(sub('a'), 'en', true, T0)
    expect(await removeFollowsIn([TID])).toBe(2)
    expect((await getRecord(sub('a').endpoint))!.site).toBe(true)
    expect(await getRecord(sub('b').endpoint)).toBeNull()
  })

  it('turning site news off leaves a device that still follows someone', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await setSite(sub('a'), 'en', true, T0)
    const r = await setSite(sub('a'), 'en', false, T0)
    expect(r.ok && r.site).toBe(false)
    expect(r.ok && r.follows).toHaveLength(1)
    expect((await getRecord(sub('a').endpoint))!.site).toBeUndefined()
  })

  it('does not create a record just to turn site news off', async () => {
    expect(await setSite(sub('zz'), 'en', false, T0)).toEqual({ ok: true, follows: [], site: false })
    expect(await listRecords()).toEqual([])
  })

  it('reports site news alongside the follows when the device is touched', async () => {
    await addFollow(sub('a'), 'en', player('1'), T0)
    await setSite(sub('a'), 'en', true, T0)
    const touched = await touchRecord(sub('a').endpoint, T0 + 2 * DAY)
    expect(touched).toEqual({ follows: [expect.objectContaining({ playerId: '1' })], site: true })
    expect(await touchRecord(sub('zz').endpoint, T0)).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/push-store.test.ts -t 'site news'`
Expected: FAIL — `setSite` is not exported from `lib/push/store`.

- [ ] **Step 3: Add `site` to the record type**

In `lib/push/types.ts`, inside `PushSubscriptionRecord`, after `os?`:

```ts
  /** This device asked to be told when something new is published on the
   *  site: a tournament, its draws, its schedule. Independent of follows —
   *  a device may have this on and follow nobody. Absent means off. */
  site?: boolean
```

- [ ] **Step 4: Implement `setSite` and the lifecycle change**

In `lib/push/store.ts`, after the `FollowResult` type:

```ts
export type SiteResult =
  | { ok: true; follows: PushFollow[]; site: boolean }
  | { ok: false; reason: 'device-limit' }
```

Add after `removeFollow`:

```ts
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
```

In `removeFollow`, replace the deletion line:

```ts
    // A device with site news on stays: it is subscribed to the site, not to
    // this tournament.
    if (kept.length === 0 && !rec.site) map.delete(endpoint)
    else rec.follows = kept
```

In `removeFollowsIn`, replace its deletion line the same way:

```ts
      if (kept.length === 0 && !rec.site) map.delete(endpoint)
      else rec.follows = kept
```

Change `touchRecord`'s signature and its three returns:

```ts
export async function touchRecord(endpoint: string, now: number, os: DeviceOs = ''): Promise<{ follows: PushFollow[]; site: boolean } | null> {
  return change((map) => {
    const rec = map.get(endpoint)
    if (!rec) return { value: null, dirty: false }
    const osChanged = !!os && rec.os !== os
    if (osChanged) rec.os = os
    const seen = Date.parse(rec.lastSeenAt)
    const value = { follows: rec.follows.slice(), site: !!rec.site }
    if (!Number.isNaN(seen) && now - seen < TOUCH_EVERY_MS) return { value, dirty: osChanged }
    rec.lastSeenAt = new Date(now).toISOString()
    return { value, dirty: true }
  })
}
```

- [ ] **Step 5: Keep the state route compiling (it still answers only follows; Task 7 adds `site`)**

In `app/api/push/state/route.ts`, change the last line to:

```ts
  return answer({ follows: (await touchRecord(body.endpoint, Date.now(), osFromUserAgent(request.headers.get('user-agent'))))?.follows ?? [] })
```

- [ ] **Step 6: Run the store and route tests**

Run: `npx jest __tests__/push-store.test.ts __tests__/api-push-routes.test.ts`
Expected: PASS. If a route test fails because `touchRecord` is mocked to resolve an array, change that mock in `beforeEach` to `touch.mockReset().mockResolvedValue({ follows: [{ kind: 'player' }], site: false })` and keep its assertion on `follows`.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/push/types.ts lib/push/store.ts app/api/push/state/route.ts __tests__/push-store.test.ts __tests__/api-push-routes.test.ts
git commit -m "feat(push): site-news flag on the device record"
```

---

### Task 2: The published state on disk

**Files:**
- Create: `lib/push/published-state.ts`
- Test: `__tests__/push-published-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface PublishedTournament { name: string; firstSeenAt: string; announced: boolean; draws: string[]; days: string[] }`
  - `export interface PublishedState { version: 1; seeded: boolean; tournaments: Record<string, PublishedTournament> }`
  - `export const EMPTY_PUBLISHED: PublishedState`
  - `export function mergePublished(a: PublishedState, b: PublishedState): PublishedState`
  - `export function prunePublished(state: PublishedState, listed: ReadonlySet<string>, now: number): PublishedState`
  - `export async function loadPublished(): Promise<PublishedState>`
  - `export async function savePublished(next: PublishedState): Promise<void>`
  - `export function __setPublishedRootForTesting(dir: string): void`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/push-published-state.test.ts`:

```ts
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  EMPTY_PUBLISHED, loadPublished, savePublished, mergePublished, prunePublished,
  __setPublishedRootForTesting, type PublishedState,
} from '@/lib/push/published-state'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const T0 = Date.UTC(2026, 9, 12)
const DAY = 86_400_000

const state = (over: Partial<PublishedState> = {}): PublishedState => ({ version: 1, seeded: true, tournaments: {}, ...over })
const entry = (over: Partial<PublishedState['tournaments'][string]> = {}) => ({
  name: 'THE MALL 2026', firstSeenAt: new Date(T0).toISOString(), announced: true, draws: [], days: [], ...over,
})

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'push-published-'))
  __setPublishedRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('published state on disk', () => {
  it('reads as unseeded when there is no file', async () => {
    expect(await loadPublished()).toEqual(EMPTY_PUBLISHED)
    expect(EMPTY_PUBLISHED.seeded).toBe(false)
  })

  it('writes and reads a state back', async () => {
    await savePublished(state({ tournaments: { [TID]: entry({ draws: ['1'], days: ['2026-10-20'] }) } }))
    const read = await loadPublished()
    expect(read.seeded).toBe(true)
    expect(read.tournaments[TID].draws).toEqual(['1'])
  })

  it('treats a half-written file as no file at all, so the next pass seeds silently', async () => {
    await fs.writeFile(path.join(tmp, 'published.json'), '{"version":1,"tourna', 'utf8')
    expect(await loadPublished()).toEqual(EMPTY_PUBLISHED)
  })

  it('keeps what another worker wrote between the read and the write', async () => {
    await savePublished(state({ tournaments: { [TID]: entry({ draws: ['1'] }) } }))
    const mine = await loadPublished()
    // Another worker adds a draw and a whole second tournament.
    await fs.writeFile(path.join(tmp, 'published.json'), JSON.stringify(state({
      tournaments: { [TID]: entry({ draws: ['1', '4'] }), B: entry({ name: 'Other' }) },
    })), 'utf8')
    mine.tournaments[TID].days = ['2026-10-20']
    await savePublished(mine)
    const read = await loadPublished()
    expect(read.tournaments[TID].draws).toEqual(['1', '4'])
    expect(read.tournaments[TID].days).toEqual(['2026-10-20'])
    expect(read.tournaments.B).toBeTruthy()
  })

  it('merges append-only: draws and days are unions, announced never goes back', () => {
    const a = state({ tournaments: { [TID]: entry({ announced: true, draws: ['1'], days: ['2026-10-20'] }) } })
    const b = state({ seeded: false, tournaments: { [TID]: entry({ announced: false, draws: ['4'], days: ['2026-10-20', '2026-10-21'] }) } })
    const m = mergePublished(a, b)
    expect(m.seeded).toBe(true)
    expect(m.tournaments[TID].draws).toEqual(['1', '4'])
    expect(m.tournaments[TID].days).toEqual(['2026-10-20', '2026-10-21'])
    expect(m.tournaments[TID].announced).toBe(true)
    expect(m.tournaments[TID].firstSeenAt).toBe(new Date(T0).toISOString())
  })

  it('prunes a tournament that is no longer listed and older than 30 days, and keeps the rest', () => {
    const old = new Date(T0 - 31 * DAY).toISOString()
    const s = state({ tournaments: {
      GONE_OLD: entry({ firstSeenAt: old }),
      GONE_NEW: entry({ firstSeenAt: new Date(T0 - 2 * DAY).toISOString() }),
      [TID]: entry({ firstSeenAt: old }),
    } })
    const pruned = prunePublished(s, new Set([TID]), T0)
    expect(Object.keys(pruned.tournaments).sort()).toEqual(['AAAAAAAA-0000-0000-0000-000000000001', 'GONE_NEW'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/push-published-state.test.ts`
Expected: FAIL — cannot find module `@/lib/push/published-state`.

- [ ] **Step 3: Implement the module**

Create `lib/push/published-state.ts`. The disk mechanics are `lib/push/sent-log.ts`'s, for its reasons: the leader lease moves between workers on reload, so a worker trusts its copy only while the file is the one it last read or wrote, and a write merges whatever is on disk first.

```ts
import { promises as fs } from 'fs'
import path from 'path'

// What has already been announced as published: per tournament, whether its
// arrival was announced, which draws were announced as holding entries, and
// which schedule days were announced. Append-only — a draw or a date, once in,
// never leaves, so BAT re-publishing cannot fire a second time.
//
// Kept on globalThis for the reason given in lib/push/store.ts.

export interface PublishedTournament {
  name: string
  firstSeenAt: string
  announced: boolean
  /** Draw numbers announced as published with entries. */
  draws: string[]
  /** Schedule dates (YYYY-MM-DD) announced as new playing days. */
  days: string[]
}

export interface PublishedState {
  version: 1
  /** False only before the very first pass has written a baseline. While it is
   *  false nothing is announced: otherwise one deploy announces every bracket
   *  already out. */
  seeded: boolean
  tournaments: Record<string, PublishedTournament>
}

export const EMPTY_PUBLISHED: PublishedState = { version: 1, seeded: false, tournaments: {} }

/** A tournament entry is forgotten once it is off the site and this old. */
const PRUNE_AFTER_MS = 30 * 86_400_000

interface PublishedStateHolder {
  root: string
  readMtimeMs: number | null
  chain: Promise<unknown>
  writes: number
}

const g = globalThis as typeof globalThis & { __batmatchPushPublished?: PublishedStateHolder }
const holder: PublishedStateHolder = (g.__batmatchPushPublished ??= {
  root: path.join(process.cwd(), '.cache', 'push'),
  readMtimeMs: null,
  chain: Promise.resolve(),
  writes: 0,
})

export function __setPublishedRootForTesting(dir: string): void {
  holder.root = dir
  holder.readMtimeMs = null
  holder.chain = Promise.resolve()
}

const file = () => path.join(holder.root, 'published.json')

const mtimeOf = async (): Promise<number | null> => {
  try { return (await fs.stat(file())).mtimeMs } catch { return null }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && !!x))) : []

function parse(raw: string): PublishedState {
  const parsed = JSON.parse(raw) as Partial<PublishedState>
  const tournaments: Record<string, PublishedTournament> = {}
  for (const [id, value] of Object.entries(parsed.tournaments ?? {})) {
    const v = value as Partial<PublishedTournament>
    if (typeof v?.name !== 'string') continue
    tournaments[id.toUpperCase()] = {
      name: v.name,
      firstSeenAt: typeof v.firstSeenAt === 'string' ? v.firstSeenAt : '',
      announced: v.announced === true,
      draws: strings(v.draws),
      days: strings(v.days),
    }
  }
  return { version: 1, seeded: parsed.seeded === true, tournaments }
}

/** The state on disk. Missing, unreadable or half-written all read as "nothing
 *  known yet", which makes the next pass seed silently rather than announce
 *  everything already published. */
async function readDisk(): Promise<PublishedState> {
  try {
    return parse(await fs.readFile(file(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] published state unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
    return EMPTY_PUBLISHED
  }
}

export async function loadPublished(): Promise<PublishedState> {
  holder.readMtimeMs = await mtimeOf()
  return readDisk()
}

/** Union of two states: draws and days are appended, `announced` and `seeded`
 *  never go back to false, and the earlier `firstSeenAt` wins. */
export function mergePublished(a: PublishedState, b: PublishedState): PublishedState {
  const tournaments: Record<string, PublishedTournament> = {}
  for (const id of new Set([...Object.keys(a.tournaments), ...Object.keys(b.tournaments)])) {
    const x = a.tournaments[id]
    const y = b.tournaments[id]
    if (!x || !y) { tournaments[id] = (x ?? y)!; continue }
    const firstSeenAt = [x.firstSeenAt, y.firstSeenAt].filter(Boolean).sort()[0] ?? ''
    tournaments[id] = {
      // The newer write carries the name upstream shows now.
      name: y.name || x.name,
      firstSeenAt,
      announced: x.announced || y.announced,
      draws: Array.from(new Set([...x.draws, ...y.draws])),
      days: Array.from(new Set([...x.days, ...y.days])).sort(),
    }
  }
  return { version: 1, seeded: a.seeded || b.seeded, tournaments }
}

export function prunePublished(state: PublishedState, listed: ReadonlySet<string>, now: number): PublishedState {
  const tournaments: Record<string, PublishedTournament> = {}
  for (const [id, entry] of Object.entries(state.tournaments)) {
    const seen = Date.parse(entry.firstSeenAt)
    const old = !Number.isNaN(seen) && now - seen > PRUNE_AFTER_MS
    if (!listed.has(id) && old) continue
    tournaments[id] = entry
  }
  return { ...state, tournaments }
}

export async function savePublished(next: PublishedState): Promise<void> {
  const run = holder.chain.then(async () => {
    const merged = (await mtimeOf()) !== holder.readMtimeMs ? mergePublished(await readDisk(), next) : next
    const tmp = `${file()}.tmp.${process.pid}.${++holder.writes}`
    await fs.mkdir(holder.root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(merged), 'utf8')
    await fs.rename(tmp, file())
    holder.readMtimeMs = await mtimeOf()
  })
  holder.chain = run.catch(() => undefined)
  return run
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/push-published-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/push/published-state.ts __tests__/push-published-state.test.ts
git commit -m "feat(push): append-only published state on disk"
```

---

### Task 3: Deciding what is due — the pure function

**Files:**
- Create: `lib/push/publications.ts`
- Modify: `lib/push/types.ts` (publication types)
- Test: `__tests__/push-publications.test.ts`

**Interfaces:**
- Consumes: `PublishedState`, `PublishedTournament`, `mergePublished` from Task 2.
- Produces:
  - In `lib/push/types.ts`: `export type PublicationKind = 'tournament' | 'bracket' | 'schedule'` and `export interface Publication { kind: PublicationKind; tournamentId: string; tournamentName: string; items: string[] }`
  - In `lib/push/publications.ts`:
    - `export interface DrawSnapshot { drawNum: string; name: string; entrantCount?: number }`
    - `export interface DaySnapshot { dateIso: string; hasMatches?: boolean }`
    - `export interface TournamentSnapshot { id: string; name: string; draws: DrawSnapshot[] | null; days: DaySnapshot[] | null }`
    - `export function duePublications(input: { snapshots: TournamentSnapshot[]; state: PublishedState; todayIso: string; nowIso: string }): { publications: Publication[]; state: PublishedState }`
    - `export function probeTargets(draws: DrawSnapshot[], announced: ReadonlySet<string>, cap: number, cursor: number): { drawNums: string[]; nextCursor: number }`
    - `export const PROBE_CAP = 5`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/push-publications.test.ts`:

```ts
import { duePublications, probeTargets, PROBE_CAP, type TournamentSnapshot } from '@/lib/push/publications'
import { EMPTY_PUBLISHED, type PublishedState } from '@/lib/push/published-state'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const TODAY = '2026-10-12'
const NOW = '2026-10-12T04:00:00.000Z'

const snap = (over: Partial<TournamentSnapshot> = {}): TournamentSnapshot => ({
  id: TID, name: 'THE MALL 2026', draws: [], days: [], ...over,
})
const seeded = (tournaments: PublishedState['tournaments'] = {}): PublishedState => ({ version: 1, seeded: true, tournaments })
const entry = (over: Partial<PublishedState['tournaments'][string]> = {}) => ({
  name: 'THE MALL 2026', firstSeenAt: NOW, announced: true, draws: [], days: [], ...over,
})
const due = (snapshots: TournamentSnapshot[], state = seeded()) =>
  duePublications({ snapshots, state, todayIso: TODAY, nowIso: NOW })

describe('duePublications — first run', () => {
  it('announces nothing and records the whole snapshot', () => {
    const r = due([snap({
      draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }],
      days: [{ dateIso: '2026-10-20', hasMatches: true }],
    })], EMPTY_PUBLISHED)
    expect(r.publications).toEqual([])
    expect(r.state.seeded).toBe(true)
    expect(r.state.tournaments[TID]).toEqual(expect.objectContaining({ announced: true, draws: ['1'], days: ['2026-10-20'] }))
  })
})

describe('duePublications — a new tournament', () => {
  it('announces the tournament once and records its draws and days silently', () => {
    const r = due([snap({
      draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }],
      days: [{ dateIso: '2026-10-20', hasMatches: true }],
    })])
    expect(r.publications).toEqual([{ kind: 'tournament', tournamentId: TID, tournamentName: 'THE MALL 2026', items: [] }])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
    expect(r.state.tournaments[TID].days).toEqual(['2026-10-20'])
    // A second pass over the same snapshot says nothing.
    expect(due([snap({ draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }], days: [{ dateIso: '2026-10-20', hasMatches: true }] })], r.state).publications).toEqual([])
  })
})

describe('duePublications — draws', () => {
  it('announces draws that hold entries, and again when a later batch lands', () => {
    const first = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '2', name: 'GS U15', entrantCount: 8 },
      { drawNum: '3', name: 'BD U17', entrantCount: 0 },
    ] })], seeded({ [TID]: entry() }))
    expect(first.publications).toEqual([{ kind: 'bracket', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['BS U15', 'GS U15'] }])
    expect(first.state.tournaments[TID].draws).toEqual(['1', '2'])

    const second = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '3', name: 'BD U17', entrantCount: 12 },
    ] })], first.state)
    expect(second.publications).toEqual([{ kind: 'bracket', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['BD U17'] }])
    expect(second.state.tournaments[TID].draws).toEqual(['1', '2', '3'])
  })

  it('never fires or records a draw whose count is zero or unknown', () => {
    const r = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 0 },
      { drawNum: '2', name: 'GS U15' },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications).toEqual([])
    expect(r.state.tournaments[TID].draws).toEqual([])
  })

  it('names a repeated draw once and ignores an empty draw number', () => {
    const r = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '', name: 'Nameless', entrantCount: 4 },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications[0].items).toEqual(['BS U15'])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
  })

  it('leaves the draws alone when they could not be read', () => {
    const r = due([snap({ draws: null })], seeded({ [TID]: entry({ draws: ['1'] }) }))
    expect(r.publications).toEqual([])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
  })
})

describe('duePublications — schedule', () => {
  it('announces new future playing days only', () => {
    const r = due([snap({ days: [
      { dateIso: '2026-10-11', hasMatches: true },
      { dateIso: TODAY, hasMatches: true },
      { dateIso: '2026-10-20', hasMatches: true },
      { dateIso: '2026-10-21', hasMatches: false },
      { dateIso: '2026-10-22' },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications).toEqual([{ kind: 'schedule', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['2026-10-20'] }])
    expect(r.state.tournaments[TID].days).toEqual(['2026-10-20'])
  })

  it('does not announce a day it has already announced', () => {
    const r = due([snap({ days: [{ dateIso: '2026-10-20', hasMatches: true }] })], seeded({ [TID]: entry({ days: ['2026-10-20'] }) }))
    expect(r.publications).toEqual([])
  })
})

describe('duePublications — names', () => {
  it('announces under the name upstream shows now, not the stored one', () => {
    const r = due([snap({ name: 'THE MALL 2026 (rescheduled)', draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] })],
      seeded({ [TID]: entry({ name: 'THE MALL 2026' }) }))
    expect(r.publications[0].tournamentName).toBe('THE MALL 2026 (rescheduled)')
    expect(r.state.tournaments[TID].name).toBe('THE MALL 2026 (rescheduled)')
  })
})

describe('probeTargets', () => {
  const draws = [
    { drawNum: '1', name: 'A', entrantCount: 16 },
    { drawNum: '2', name: 'B', entrantCount: 0 },
    { drawNum: '3', name: 'C' },
    { drawNum: '4', name: 'D', entrantCount: 0 },
  ]

  it('probes un-announced draws whose count is zero or unknown, never the announced ones', () => {
    const r = probeTargets(draws, new Set(['1']), PROBE_CAP, 0)
    expect(r.drawNums).toEqual(['2', '3', '4'])
  })

  it('never probes a draw already known to hold entries', () => {
    expect(probeTargets([{ drawNum: '1', name: 'A', entrantCount: 16 }], new Set(), PROBE_CAP, 0).drawNums).toEqual([])
  })

  it('caps the batch and rotates so a later pass covers the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i}`, entrantCount: 0 }))
    const first = probeTargets(many, new Set(), 5, 0)
    expect(first.drawNums).toEqual(['1', '2', '3', '4', '5'])
    const second = probeTargets(many, new Set(), 5, first.nextCursor)
    expect(second.drawNums).toEqual(['6', '7', '1', '2', '3'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/push-publications.test.ts`
Expected: FAIL — cannot find module `@/lib/push/publications`.

- [ ] **Step 3: Add the publication types**

Append to `lib/push/types.ts`:

```ts
/** What a publication notification is about. */
export type PublicationKind = 'tournament' | 'bracket' | 'schedule'

/** One thing newly published, for every device with site news on. Not a
 *  `DueAlert`: there is no match behind it. */
export interface Publication {
  kind: PublicationKind
  /** Upper-case GUID. */
  tournamentId: string
  /** As the site lists it now, not as it was when first seen. */
  tournamentName: string
  /** Draw names for `bracket`, ISO dates for `schedule`, empty for `tournament`. */
  items: string[]
}
```

Widen `Stage` in the same file (used by `RecentSend`, so a publication row can be written):

```ts
export type Stage = 'soon' | 'playing' | 'result' | PublicationKind
```

- [ ] **Step 4: Implement the pure function**

Create `lib/push/publications.ts`:

```ts
import type { Publication } from './types'
import type { PublishedState, PublishedTournament } from './published-state'

export interface DrawSnapshot {
  drawNum: string
  name: string
  /** Undefined means not counted, which is never a zero (lib/bracket-state.ts). */
  entrantCount?: number
}

export interface DaySnapshot {
  dateIso: string
  hasMatches?: boolean
}

export interface TournamentSnapshot {
  /** Upper-case GUID. */
  id: string
  name: string
  /** Null when the draws could not be read: nothing is announced or recorded
   *  for them. A failed read is not evidence that nothing is published. */
  draws: DrawSnapshot[] | null
  /** Null for the same reason. */
  days: DaySnapshot[] | null
}

/** Draws probed per tournament per pass. Discovery's BRACKET_GATE_PROBE_CAP,
 *  for its reason: a tournament with 33 empty draws must not take 33 fetches. */
export const PROBE_CAP = 5

const entered = (draws: DrawSnapshot[]): DrawSnapshot[] =>
  draws.filter((d) => !!d.drawNum && typeof d.entrantCount === 'number' && d.entrantCount > 0)

const playingDays = (days: DaySnapshot[], todayIso: string): string[] =>
  Array.from(new Set(days.filter((d) => !!d.dateIso && d.dateIso > todayIso && d.hasMatches === true).map((d) => d.dateIso))).sort()

/** The draws worth a bracket fetch: not yet announced, and not already known
 *  to hold entries. A cached zero is included — `cachedEntrantCounts` has no
 *  TTL, so a draw whose empty shape was published on Monday answers zero for
 *  ever and Wednesday's entries would otherwise never be noticed. The cursor
 *  rotates the window so a big tournament is covered over several passes. */
export function probeTargets(
  draws: DrawSnapshot[],
  announced: ReadonlySet<string>,
  cap: number,
  cursor: number,
): { drawNums: string[]; nextCursor: number } {
  const want = draws
    .filter((d) => !!d.drawNum && !announced.has(d.drawNum))
    .filter((d) => d.entrantCount === undefined || d.entrantCount === 0)
    .map((d) => d.drawNum)
  const unique = Array.from(new Set(want))
  if (unique.length === 0) return { drawNums: [], nextCursor: 0 }
  const start = ((cursor % unique.length) + unique.length) % unique.length
  const take = Math.min(cap, unique.length)
  const drawNums = Array.from({ length: take }, (_, i) => unique[(start + i) % unique.length])
  return { drawNums, nextCursor: (start + take) % unique.length }
}

/** What should go out, and the state that follows from it. Pure: the caller
 *  has already fetched, and writes the state whether or not any device is
 *  listening. An unseeded state announces nothing — it records a baseline, so
 *  a first deploy does not announce every bracket already published. */
export function duePublications(input: {
  snapshots: TournamentSnapshot[]
  state: PublishedState
  todayIso: string
  nowIso: string
}): { publications: Publication[]; state: PublishedState } {
  const { snapshots, state, todayIso, nowIso } = input
  const tournaments: Record<string, PublishedTournament> = { ...state.tournaments }
  const publications: Publication[] = []

  for (const s of snapshots) {
    const id = s.id.toUpperCase()
    const known = tournaments[id]
    const drawsOut = known ? known.draws.slice() : []
    const daysOut = known ? known.days.slice() : []

    if (!known) {
      // New to the state: one notice for the tournament itself, and whatever
      // it already has recorded without a word, so it does not announce three
      // times on arrival.
      if (s.draws) drawsOut.push(...entered(s.draws).map((d) => d.drawNum))
      if (s.days) daysOut.push(...playingDays(s.days, todayIso))
      if (state.seeded) {
        publications.push({ kind: 'tournament', tournamentId: id, tournamentName: s.name, items: [] })
      }
      tournaments[id] = {
        name: s.name,
        firstSeenAt: nowIso,
        announced: true,
        draws: Array.from(new Set(drawsOut)),
        days: Array.from(new Set(daysOut)).sort(),
      }
      continue
    }

    if (s.draws) {
      const seen = new Set(drawsOut)
      const fresh: DrawSnapshot[] = []
      for (const d of entered(s.draws)) {
        if (seen.has(d.drawNum)) continue
        seen.add(d.drawNum)
        fresh.push(d)
      }
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'bracket', tournamentId: id, tournamentName: s.name, items: fresh.map((d) => d.name) })
        }
        drawsOut.push(...fresh.map((d) => d.drawNum))
      }
    }

    if (s.days) {
      const seen = new Set(daysOut)
      const fresh = playingDays(s.days, todayIso).filter((d) => !seen.has(d))
      if (fresh.length > 0) {
        if (state.seeded) {
          publications.push({ kind: 'schedule', tournamentId: id, tournamentName: s.name, items: fresh })
        }
        daysOut.push(...fresh)
      }
    }

    tournaments[id] = {
      ...known,
      // Upstream renames happen; the stored name follows the snapshot.
      name: s.name,
      draws: Array.from(new Set(drawsOut)),
      days: Array.from(new Set(daysOut)).sort(),
    }
  }

  return { publications, state: { version: 1, seeded: true, tournaments } }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/push-publications.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/push/types.ts lib/push/publications.ts __tests__/push-publications.test.ts
git commit -m "feat(push): decide which publications are due"
```

---

### Task 4: The notification text

**Files:**
- Modify: `lib/push/text.ts`
- Modify: `components/BmStats.tsx:84` (its local `stage` literal type)
- Test: `__tests__/push-text.test.ts`

**Interfaces:**
- Consumes: `Publication` (Task 3).
- Produces: `export function publicationPayload(pub: Publication, lang: Lang, minuteKey: string): PushPayload`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/push-text.test.ts`. Extend its import to include `publicationPayload`, and add `import type { Publication } from '@/lib/push/types'`.

```ts
const pub = (over: Partial<Publication> = {}): Publication => ({
  kind: 'bracket', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['BS U15'], ...over,
})
const MINUTE = '2026-10-12T04:00'

describe('publicationPayload', () => {
  it('announces a new tournament by name, and links to it', () => {
    const p = publicationPayload(pub({ kind: 'tournament', items: [] }), 'en', MINUTE)
    expect(p.title).toBe('New tournament')
    expect(p.body).toBe('THE MALL 2026')
    expect(p.url).toBe(`/?tournament=${TID}`)
    expect(p.tag).toBe(`pub:t:${TID}`)
  })

  it('names the draws that are out', () => {
    const p = publicationPayload(pub({ items: ['BS U15', 'GS U15'] }), 'en', MINUTE)
    expect(p.title).toBe('Draws are out')
    expect(p.body).toBe('THE MALL 2026 · BS U15, GS U15')
    expect(p.tag).toBe(`pub:b:${TID}:${MINUTE}`)
  })

  it('caps a 33-draw publication at four names and counts the rest', () => {
    const items = Array.from({ length: 33 }, (_, i) => `D${i + 1}`)
    const p = publicationPayload(pub({ items }), 'en', MINUTE)
    expect(p.body).toBe('THE MALL 2026 · D1, D2, D3, D4 +29 more')
    expect(publicationPayload(pub({ items }), 'th', MINUTE).body).toBe('THE MALL 2026 · D1, D2, D3, D4 +อีก 29')
  })

  it('gives schedule dates as days and months, not ISO', () => {
    const p = publicationPayload(pub({ kind: 'schedule', items: ['2026-10-20', '2026-11-01'] }), 'en', MINUTE)
    expect(p.title).toBe('Schedule published')
    expect(p.body).toBe('THE MALL 2026 · 20 Oct, 1 Nov')
    expect(p.tag).toBe(`pub:s:${TID}:${MINUTE}`)
  })

  it('speaks Thai to a Thai device', () => {
    expect(publicationPayload(pub({ kind: 'tournament', items: [] }), 'th', MINUTE).title).toBe('ทัวร์นาเมนต์ใหม่')
    expect(publicationPayload(pub(), 'th', MINUTE).title).toBe('สายการแข่งขันออกแล้ว')
    const s = publicationPayload(pub({ kind: 'schedule', items: ['2026-10-20'] }), 'th', MINUTE)
    expect(s.title).toBe('ตารางแข่งออกแล้ว')
    expect(s.body).toBe('THE MALL 2026 · 20 ต.ค.')
  })

  it('never collides with a match alert tag', () => {
    expect(publicationPayload(pub(), 'en', MINUTE).tag.startsWith('pub:')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/push-text.test.ts -t 'publicationPayload'`
Expected: FAIL — `publicationPayload` is not exported from `lib/push/text`.

- [ ] **Step 3: Implement the payload builder**

Append to `lib/push/text.ts` (and extend its type import to include `Publication`, `PublicationKind`):

```ts
const PUB_TITLES: Record<PublicationKind, { en: string; th: string }> = {
  tournament: { en: 'New tournament', th: 'ทัวร์นาเมนต์ใหม่' },
  bracket: { en: 'Draws are out', th: 'สายการแข่งขันออกแล้ว' },
  schedule: { en: 'Schedule published', th: 'ตารางแข่งออกแล้ว' },
}

// Written out rather than formatted with Intl: this runs on the server, where
// the available locale data is not something a notification should depend on.
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** "2026-10-20" as "20 Oct" / "20 ต.ค.". Anything not a date is left alone. */
function shortDate(dateIso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso)
  if (!m) return dateIso
  const month = (lang === 'th' ? MONTHS_TH : MONTHS_EN)[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month}` : dateIso
}

const PUB_ITEMS = 4
const TAG_LETTER: Record<PublicationKind, string> = { tournament: 't', bracket: 'b', schedule: 's' }

/** One newly published thing, for one device, in its language. The tag's `pub:`
 *  prefix keeps it from replacing a match alert (whose tag is `<drawNum>|<ids>`);
 *  the minute key lets a second batch of draws stand beside the first instead
 *  of overwriting it. A tournament is announced once ever, so its tag has no
 *  minute in it. */
export function publicationPayload(pub: Publication, lang: Lang, minuteKey: string): PushPayload {
  const th = lang === 'th'
  const shown = pub.items.slice(0, PUB_ITEMS).map((i) => (pub.kind === 'schedule' ? shortDate(i, lang) : i))
  const rest = pub.items.length - shown.length
  const list = shown.join(', ') + (rest > 0 ? (th ? ` +อีก ${rest}` : ` +${rest} more`) : '')
  const title = PUB_TITLES[pub.kind][th ? 'th' : 'en']
  const letter = TAG_LETTER[pub.kind]
  return {
    title,
    body: [pub.tournamentName, list].filter(Boolean).join(' · '),
    url: `/?tournament=${pub.tournamentId}`,
    tag: pub.kind === 'tournament' ? `pub:t:${pub.tournamentId}` : `pub:${letter}:${pub.tournamentId}:${minuteKey}`,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/push-text.test.ts`
Expected: PASS, including the existing match-alert tests.

- [ ] **Step 5: Widen the status table's local type**

`components/BmStats.tsx:84` declares `stage: 'soon' | 'next' | 'result'` — already stale (the watcher sends `playing`, never `next`), and a publication row would not typecheck. Replace that line with:

```ts
      stage: 'soon' | 'playing' | 'result' | 'tournament' | 'bracket' | 'schedule'
```

The table prints `send.stage` verbatim (`components/BmStats.tsx:838`), so nothing else changes.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/push/text.ts components/BmStats.tsx __tests__/push-text.test.ts
git commit -m "feat(push): notification text for publications"
```

---

### Task 5: The pass — fetch, decide, record, send

**Files:**
- Modify: `lib/push/publications.ts` (add `runPublicationPass` and its deps)
- Test: `__tests__/push-publication-pass.test.ts`

**Interfaces:**
- Consumes: `duePublications`, `probeTargets`, `PROBE_CAP` (Task 3); `PublishedState`, `prunePublished` (Task 2); `publicationPayload` (Task 4); `Sender`/`SendResult` from `lib/push/sender`; `RecentSend` from `lib/push/recent-sends`; `endpointHash` from `lib/push/devices`.
- Produces:
  - `export interface PublicationDeps { ... }` (exact shape in Step 3)
  - `export async function runPublicationPass(deps: PublicationDeps): Promise<{ publications: number; sent: number; failed: number; gone: number }>`
  - `export function __resetPublicationsForTesting(): void`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/push-publication-pass.test.ts`:

```ts
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
  days?: Record<string, Array<{ dateIso: string; hasMatches?: boolean }> | null>
  results?: Record<string, SendResult>
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/push-publication-pass.test.ts`
Expected: FAIL — `runPublicationPass` is not exported.

- [ ] **Step 3: Implement the pass**

Append to `lib/push/publications.ts` (extend the imports at the top of the file):

```ts
import { endpointHash } from './devices'
import { prunePublished } from './published-state'
import { publicationPayload } from './text'
import type { PushSubscriptionRecord } from './types'
import type { Sender, SendResult } from './sender'
import type { RecentSend } from './recent-sends'

export interface PublicationDeps {
  now: () => number
  todayIso: () => string
  isBatDown: () => boolean
  /** Every tournament the site lists, with its name and finished flag. */
  listTournaments: () => Promise<Array<{ id: string; name: string; done: boolean }>>
  /** The tournament's visible draws with whatever entrant counts are cached,
   *  or null when they could not be read. */
  fetchDraws: (tournamentId: string) => Promise<DrawSnapshot[] | null>
  /** Fetches one bracket so its entrant count becomes known. Failure is fine:
   *  the count stays unknown and the draw is probed again next pass. */
  probeBracket: (tournamentId: string, drawNum: string) => Promise<void>
  /** The tournament's schedule days, or null when they could not be read. */
  fetchDays: (tournamentId: string) => Promise<DaySnapshot[] | null>
  loadState: () => Promise<PublishedState>
  saveState: (state: PublishedState) => Promise<void>
  listRecords: () => Promise<PushSubscriptionRecord[]>
  send: Sender
  removeRecord: (endpoint: string) => Promise<void>
  record: (result: SendResult, dayIso: string) => void
  noteSend: (row: RecentSend) => Promise<void>
}

/** Where each tournament's bracket probing got to, so a big tournament is
 *  covered over several passes. In memory: a restart simply starts again at
 *  the first un-announced draw. */
const probeCursors = new Map<string, number>()

export function __resetPublicationsForTesting(): void {
  probeCursors.clear()
}

/** One publication pass. Detection and the state write happen whether or not
 *  any device is listening: a pass that skipped them for want of an audience
 *  would hand the next person who switches site news on a month of backlog. */
export async function runPublicationPass(deps: PublicationDeps): Promise<{ publications: number; sent: number; failed: number; gone: number }> {
  const tally = { publications: 0, sent: 0, failed: 0, gone: 0 }
  // A stale read would announce publications that have not happened.
  if (deps.isBatDown()) return tally

  const state = await deps.loadState()
  const listed = await deps.listTournaments()
  // An upstream hiccup is not "everything is gone" — discovery's own rule.
  if (listed.length === 0 && Object.keys(state.tournaments).length > 0) {
    console.warn('[push] empty tournament list vs non-empty published state — skipping publication pass')
    return tally
  }

  const snapshots: TournamentSnapshot[] = []
  for (const t of listed) {
    if (t.done) continue
    const id = t.id.toUpperCase()
    let draws = await deps.fetchDraws(id).catch(() => null)
    if (draws) {
      // Refresh the counts that could still be hiding entries, then read the
      // list again: /api/bracket caches what it fetched.
      const announced = new Set(state.tournaments[id]?.draws ?? [])
      const { drawNums, nextCursor } = probeTargets(draws, announced, PROBE_CAP, probeCursors.get(id) ?? 0)
      probeCursors.set(id, nextCursor)
      if (drawNums.length > 0) {
        for (const drawNum of drawNums) await deps.probeBracket(id, drawNum).catch(() => undefined)
        draws = (await deps.fetchDraws(id).catch(() => null)) ?? draws
      }
    }
    const days = await deps.fetchDays(id).catch(() => null)
    snapshots.push({ id, name: t.name, draws, days })
  }

  const decided = duePublications({
    snapshots,
    state,
    todayIso: deps.todayIso(),
    nowIso: new Date(deps.now()).toISOString(),
  })
  tally.publications = decided.publications.length

  // Written before anything is sent: delivery is at-most-once on purpose (the
  // state is global, so a retry would re-notify every device already reached),
  // and a reload mid-send must not announce twice.
  await deps.saveState(prunePublished(decided.state, new Set(snapshots.map((s) => s.id)), deps.now()))
  if (decided.publications.length === 0) return tally

  const records = (await deps.listRecords()).filter((r) => r.site === true)
  if (records.length === 0) return tally

  const dayIso = deps.todayIso()
  const minuteKey = new Date(deps.now()).toISOString().slice(0, 16)
  const goneEndpoints = new Set<string>()
  for (const pub of decided.publications) {
    for (const record of records) {
      if (goneEndpoints.has(record.endpoint)) continue
      const payload = publicationPayload(pub, record.lang, minuteKey)
      const result: SendResult = await deps.send(record, payload).catch(() => 'failed' as const)
      deps.record(result, dayIso)
      await deps.noteSend({
        at: new Date(deps.now()).toISOString(),
        device: endpointHash(record.endpoint),
        stage: pub.kind,
        result,
        draw: pub.tournamentName,
        round: '',
        match: payload.body,
        via: 'site news',
      })
      if (result === 'ok') tally.sent++
      else if (result === 'gone') {
        tally.gone++
        goneEndpoints.add(record.endpoint)
        await deps.removeRecord(record.endpoint)
      } else tally.failed++
    }
  }
  return tally
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/push-publication-pass.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/push/publications.ts __tests__/push-publication-pass.test.ts
git commit -m "feat(push): run the publication pass"
```

---

### Task 6: Wiring — tournament names, fetchers, and the watcher

**Files:**
- Modify: `lib/push/tournaments.ts` (add `publicationTournaments`)
- Modify: `lib/push/publications.ts` (add the three origin fetchers)
- Modify: `lib/push/watcher.ts` (call the pass every fifth tick, own in-flight flag)
- Test: `__tests__/push-tournaments.test.ts`, `__tests__/push-publication-fetchers.test.ts`

**Interfaces:**
- Consumes: `runPublicationPass`, `PublicationDeps` (Task 5); `loadPublished`/`savePublished` (Task 2).
- Produces:
  - `export async function publicationTournaments(): Promise<Array<{ id: string; name: string; done: boolean }>>` in `lib/push/tournaments.ts`
  - `export function makeFetchDraws(origin: string, fetchFn?: FetchLike): (tournamentId: string) => Promise<DrawSnapshot[] | null>`
  - `export function makeFetchScheduleDays(origin: string, fetchFn?: FetchLike): (tournamentId: string) => Promise<DaySnapshot[] | null>`
  - `export function makeProbeBracket(origin: string, fetchFn?: FetchLike): (tournamentId: string, drawNum: string) => Promise<void>`

- [ ] **Step 1: Write the failing tests for the tournament list**

Add to `__tests__/push-tournaments.test.ts`, which already mocks
`lib/tournaments-registry` and `lib/discovery-store` and defines `MANUAL`,
`FOUND`, `BWF`, `registry`, `discovered` and `entry`. Extend its import to
`import { alertTournaments, publicationTournaments } from '@/lib/push/tournaments'`.

```ts
describe('publicationTournaments', () => {
  it('is empty when the site lists nothing', async () => {
    expect(await publicationTournaments()).toEqual([])
  })

  it('gives a hand-listed BAT tournament with its name and finished flag', async () => {
    registry.mockReturnValue([{ id: MANUAL.toLowerCase(), provider: 'bat', name: 'THE MALL 2026', done: true }])
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'THE MALL 2026', done: true }])
  })

  it('gives a tournament the site found by itself, upper-cased and not finished', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [{ ...entry(FOUND.toLowerCase()), name: 'Found Open' }] })
    expect(await publicationTournaments()).toEqual([{ id: FOUND, name: 'Found Open', done: false }])
  })

  it('includes a found tournament whose draws are not out yet — unlike alertTournaments', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [{ ...entry(FOUND, false), name: 'Found Open' }] })
    expect(await publicationTournaments()).toEqual([{ id: FOUND, name: 'Found Open', done: false }])
    expect((await alertTournaments()).has(FOUND)).toBe(false)
  })

  it('leaves out BWF tournaments, even one that was also found', async () => {
    registry.mockReturnValue([{ id: BWF, provider: 'bwf', name: 'A BWF event', done: false }])
    discovered.mockResolvedValue({ version: 1, entries: [{ ...entry(BWF), name: 'A BWF event' }] })
    expect(await publicationTournaments()).toEqual([])
  })

  it('lets the hand-listed entry decide when a tournament is in both lists', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', name: 'Hand name', done: true }])
    discovered.mockResolvedValue({ version: 1, entries: [{ ...entry(MANUAL), name: 'Found name' }] })
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'Hand name', done: true }])
  })

  it('still answers from the hand-listed ones when the found list cannot be read', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', name: 'THE MALL 2026', done: false }])
    discovered.mockRejectedValue(new Error('EIO'))
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'THE MALL 2026', done: false }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/push-tournaments.test.ts -t 'publicationTournaments'`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `publicationTournaments`**

Append to `lib/push/tournaments.ts`:

```ts
/** Every BAT tournament the site knows, with the name a notification should
 *  use. `alertTournaments` cannot serve: it carries no names, and it admits a
 *  discovered tournament only once `hasBracket` is set, while a publication
 *  pass wants to see one the moment the site lists it. */
export async function publicationTournaments(): Promise<Array<{ id: string; name: string; done: boolean }>> {
  const out = new Map<string, { id: string; name: string; done: boolean }>()
  const notBat = new Set<string>()
  for (const t of listAllTournaments()) {
    const id = t.id.toUpperCase()
    if (t.provider === 'bat') out.set(id, { id, name: t.name, done: !!t.done })
    else notBat.add(id)
  }
  const found = await loadDiscovered().catch(() => null)
  for (const e of found?.entries ?? []) {
    const id = e.id.toUpperCase()
    // The hand-listed entry decides for a tournament in both lists.
    if (out.has(id) || notBat.has(id)) continue
    out.set(id, { id, name: e.name, done: false })
  }
  return Array.from(out.values())
}
```

- [ ] **Step 4: Write the failing tests for the fetchers**

Create `__tests__/push-publication-fetchers.test.ts`:

```ts
import { makeFetchDraws, makeFetchScheduleDays, makeProbeBracket } from '@/lib/push/publications'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const ok = (body: unknown) => ({ ok: true, json: async () => body })
const notOk = { ok: false, json: async () => null }

describe('makeFetchDraws', () => {
  it('asks the app for the draws with the id lower-cased, and keeps the counts', async () => {
    const urls: string[] = []
    const draws = await makeFetchDraws('http://o', async (url) => { urls.push(url); return ok([{ drawNum: '1', name: 'BS U15', size: '32', type: 'Elimination', entrantCount: 16 }]) })(TID)
    expect(urls[0]).toBe(`http://o/api/draws?id=${TID.toLowerCase()}`)
    expect(draws).toEqual([{ drawNum: '1', name: 'BS U15', entrantCount: 16 }])
  })

  it('is null when the app says no', async () => {
    expect(await makeFetchDraws('http://o', async () => notOk)(TID)).toBeNull()
  })

  it('is null when the answer is not a list', async () => {
    expect(await makeFetchDraws('http://o', async () => ok({ error: 'nope' }))(TID)).toBeNull()
  })
})

describe('makeFetchScheduleDays', () => {
  it('gives the days with their hasMatches flags', async () => {
    const urls: string[] = []
    const days = await makeFetchScheduleDays('http://o', async (url) => { urls.push(url); return ok({ days: [{ date: '20/10/2026', label: 'Tue', dateIso: '2026-10-20', hasMatches: true }], currentDate: '', groups: [] }) })(TID)
    expect(urls[0]).toBe(`http://o/api/matches?tournament=${TID}`)
    expect(days).toEqual([{ dateIso: '2026-10-20', hasMatches: true }])
  })

  it('is null when the app says no, and an empty list when there are no days', async () => {
    expect(await makeFetchScheduleDays('http://o', async () => notOk)(TID)).toBeNull()
    expect(await makeFetchScheduleDays('http://o', async () => ok({ currentDate: '', groups: [] }))(TID)).toEqual([])
  })
})

describe('makeProbeBracket', () => {
  it('asks the app for one bracket, which caches its entrant count', async () => {
    const urls: string[] = []
    await makeProbeBracket('http://o', async (url) => { urls.push(url); return ok({}) })(TID, '4')
    expect(urls[0]).toBe(`http://o/api/bracket?tournament=${TID.toLowerCase()}&event=4`)
  })

  it('swallows a failure, because an unknown count is simply probed again', async () => {
    await expect(makeProbeBracket('http://o', async () => { throw new Error('boom') })(TID, '4')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx jest __tests__/push-publication-fetchers.test.ts`
Expected: FAIL — the three makers are not exported.

- [ ] **Step 6: Implement the fetchers**

Append to `lib/push/publications.ts`:

```ts
import type { DrawInfo, MatchesData } from '@/lib/types'

// A read that never answers must not hold the pass up. The same bound the
// watcher's schedule reads use.
const FETCH_TIMEOUT_MS = 20_000

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

const signal = () => ({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

/** The tournament's visible draws, through the app's own route so the entrant
 *  counts are the ones the Bracket tab shows and BAT is never asked directly. */
export function makeFetchDraws(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string): Promise<DrawSnapshot[] | null> => {
    const res = await fetchFn(`${origin}/api/draws?id=${encodeURIComponent(tournamentId.toLowerCase())}`, signal())
    if (!res.ok) return null
    const body = (await res.json()) as DrawInfo[] | { error?: string }
    if (!Array.isArray(body)) return null
    return body.map((d) => ({
      drawNum: String(d.drawNum ?? ''),
      name: d.eventName || d.name || '',
      ...(typeof d.entrantCount === 'number' ? { entrantCount: d.entrantCount } : {}),
    }))
  }
}

/** The tournament's schedule days. An answer with no days is an empty list,
 *  not a failure: a tournament whose schedule is not out yet simply has none. */
export function makeFetchScheduleDays(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string): Promise<DaySnapshot[] | null> => {
    const res = await fetchFn(`${origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}`, signal())
    if (!res.ok) return null
    const days = ((await res.json()) as MatchesData).days
    if (!Array.isArray(days)) return []
    return days
      .filter((d) => typeof d.dateIso === 'string' && d.dateIso)
      .map((d) => ({ dateIso: d.dateIso, ...(d.hasMatches === undefined ? {} : { hasMatches: d.hasMatches }) }))
  }
}

/** Fetches one bracket so its entrant count is cached and counted. The route
 *  honours its own TTL, which is how a draw published empty on Monday is seen
 *  to hold entries on Wednesday. */
export function makeProbeBracket(origin: string, fetchFn: FetchLike = fetch as unknown as FetchLike) {
  return async (tournamentId: string, drawNum: string): Promise<void> => {
    try {
      await fetchFn(`${origin}/api/bracket?tournament=${encodeURIComponent(tournamentId.toLowerCase())}&event=${encodeURIComponent(drawNum)}`, signal())
    } catch {
      // An unknown count is probed again next pass; nothing to report.
    }
  }
}
```

- [ ] **Step 7: Run both test files**

Run: `npx jest __tests__/push-publication-fetchers.test.ts __tests__/push-tournaments.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the pass into the watcher**

In `lib/push/watcher.ts`, inside `startPushWatcher`, add to the dynamic imports near the others:

```ts
  const publications = await import('./publications')
  const published = await import('./published-state')
  const { publicationTournaments } = await import('./tournaments')
```

Build its deps after the `WatcherDeps` object:

```ts
  const publicationDeps: import('./publications').PublicationDeps = {
    now: () => Date.now(),
    todayIso: () => getTodayIso(),
    isBatDown: () => !!batDownSince(),
    listTournaments: publicationTournaments,
    fetchDraws: publications.makeFetchDraws(opts.origin),
    probeBracket: publications.makeProbeBracket(opts.origin),
    fetchDays: publications.makeFetchScheduleDays(opts.origin),
    loadState: published.loadPublished,
    saveState: published.savePublished,
    listRecords: store.listRecords,
    send: webPushSender(config),
    removeRecord: store.removeRecord,
    record: recordPush,
    noteSend: recent.recordSend,
  }
```

Add the cadence state beside `busy`:

```ts
  // The publication pass runs every fifth tick, on the same lease. It has its
  // own in-flight flag and never holds `busy`: a bracket probe can take tens of
  // seconds, and a match about to go on court must not wait for it.
  const PUBLICATION_EVERY = 5
  let ticks = 0
  let publishing = false
```

At the end of the `setInterval` callback, **after** the `finally { busy = false }` block closes — so the match tick has already released `busy` — add:

```ts
    if (++ticks % PUBLICATION_EVERY !== 0 || publishing || !opts.isLeader()) return
    publishing = true
    try {
      const p = await publications.runPublicationPass(publicationDeps)
      if (p.publications) console.log(`[push] publications=${p.publications} sent=${p.sent} failed=${p.failed} gone=${p.gone}`)
    } catch (err) {
      console.warn('[push] publication pass failed:', err instanceof Error ? err.message : err)
    } finally {
      publishing = false
    }
```

- [ ] **Step 9: Verify the whole suite and the build**

Run: `npm test`
Expected: PASS, no regressions in `push-watcher.test.ts`.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/push/tournaments.ts lib/push/publications.ts lib/push/watcher.ts __tests__/push-tournaments.test.ts __tests__/push-publication-fetchers.test.ts
git commit -m "feat(push): run publications from the watcher's lease"
```

---

### Task 7: The API

**Files:**
- Create: `app/api/push/site/route.ts`
- Modify: `app/api/push/state/route.ts`
- Test: `__tests__/api-push-routes.test.ts`

**Interfaces:**
- Consumes: `setSite`, `touchRecord` (Task 1).
- Produces: `POST /api/push/site` with `{ subscription, lang, on }` → `{ follows, site }`; `POST /api/push/state` → `{ follows, site }`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/api-push-routes.test.ts`: add `setSite: jest.fn()` to the `lib/push/store` mock, import `POST as site` from `@/app/api/push/site/route`, add `const setSiteMock = setSite as jest.Mock` and in `beforeEach` `setSiteMock.mockReset().mockResolvedValue({ ok: true, follows: [], site: true })`. Then:

```ts
describe('POST /api/push/site', () => {
  it('turns site news on for a valid subscription', async () => {
    const res = await site(post({ subscription: SUB, lang: 'th', on: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [], site: true })
    expect(setSiteMock).toHaveBeenCalledWith(expect.objectContaining({ endpoint: ENDPOINT }), 'th', true, expect.any(Number), '')
  })

  it('turns it off', async () => {
    setSiteMock.mockResolvedValue({ ok: true, follows: [], site: false })
    const res = await site(post({ subscription: SUB, on: false }))
    expect(await res.json()).toEqual({ follows: [], site: false })
    expect(setSiteMock).toHaveBeenCalledWith(expect.anything(), 'en', false, expect.any(Number), '')
  })

  it('refuses a subscription it could not parse', async () => {
    const res = await site(post({ subscription: { endpoint: 'https://evil.example/x' }, on: true }))
    expect(res.status).toBe(400)
    expect(setSiteMock).not.toHaveBeenCalled()
  })

  it('refuses when `on` is not a boolean', async () => {
    expect((await site(post({ subscription: SUB, on: 'yes' }))).status).toBe(400)
  })

  it('counts a device the server has not seen against the address', async () => {
    allow.mockReturnValue(false)
    const res = await site(post({ subscription: SUB, on: true }))
    expect(res.status).toBe(429)
    expect(setSiteMock).not.toHaveBeenCalled()
  })

  it('does not rate-limit a device the server already knows', async () => {
    known.mockResolvedValue({ endpoint: ENDPOINT })
    allow.mockReturnValue(false)
    expect((await site(post({ subscription: SUB, on: true }))).status).toBe(200)
  })

  it('answers 429 when the device limit is reached', async () => {
    setSiteMock.mockResolvedValue({ ok: false, reason: 'device-limit' })
    const res = await site(post({ subscription: SUB, on: true }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'follow limit reached', reason: 'device-limit' })
  })

  it('is 404 when the feature is off', async () => {
    config.mockReturnValue(null)
    expect((await site(post({ subscription: SUB, on: true }))).status).toBe(404)
  })

  it('takes the device OS from the user agent', async () => {
    await site(post({ subscription: SUB, on: true }, { 'user-agent': IPHONE_UA }))
    expect(setSiteMock).toHaveBeenCalledWith(expect.anything(), 'en', true, expect.any(Number), 'ios')
  })
})

describe('POST /api/push/state — site news', () => {
  it('reports the switch alongside the follows', async () => {
    touch.mockResolvedValue({ follows: [{ kind: 'player' }], site: true })
    const res = await state(post({ endpoint: ENDPOINT }))
    expect(await res.json()).toEqual({ follows: [{ kind: 'player' }], site: true })
  })

  it('says no for a device the server does not know', async () => {
    touch.mockResolvedValue(null)
    expect(await (await state(post({ endpoint: ENDPOINT }))).json()).toEqual({ follows: [], site: false })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest __tests__/api-push-routes.test.ts -t 'site'`
Expected: FAIL — cannot find `@/app/api/push/site/route`.

- [ ] **Step 3: Implement the route**

Create `app/api/push/site/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { parseSubscription } from '@/lib/push/validate'
import { getRecord, setSite } from '@/lib/push/store'
import { allowNewDevice, clientAddress } from '@/lib/push/rate-limit'
import { osFromUserAgent } from '@/lib/push/user-agent'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// Turn this device's site-news switch on or off: new tournaments, their draws
// and their schedules. It names no tournament, so there is nothing to check
// against the listed ones — unlike /api/push/follow.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; lang?: unknown; on?: unknown } | null
  const subscription = parseSubscription(body?.subscription)
  if (!subscription || typeof body?.on !== 'boolean') return answer({ error: 'subscription and on required' }, 400)
  // Only a device the server has not seen counts against the address.
  if (!(await getRecord(subscription.endpoint)) && !allowNewDevice(clientAddress(request), Date.now())) {
    return answer({ error: 'too many new devices from this address today' }, 429)
  }
  const lang = body?.lang === 'th' ? 'th' : 'en'
  const result = await setSite(subscription, lang, body.on, Date.now(), osFromUserAgent(request.headers.get('user-agent')))
  if (!result.ok) return answer({ error: 'follow limit reached', reason: result.reason }, 429)
  return answer({ follows: result.follows, site: result.site })
}
```

- [ ] **Step 4: Have the state route answer with the switch**

Replace the last line of `app/api/push/state/route.ts`'s `POST`:

```ts
  const known = await touchRecord(body.endpoint, Date.now(), osFromUserAgent(request.headers.get('user-agent')))
  return answer({ follows: known?.follows ?? [], site: known?.site ?? false })
```

- [ ] **Step 5: Run the route tests**

Run: `npx jest __tests__/api-push-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/push/site/route.ts app/api/push/state/route.ts __tests__/api-push-routes.test.ts
git commit -m "feat(push): /api/push/site, and site news in /api/push/state"
```

---

### Task 8: The browser side

**Files:**
- Modify: `lib/push/client.ts` (`setSite`, `state` return shape)
- Modify: `lib/push/fake-client.ts`
- Modify: `lib/push/PushFollowsContext.tsx`
- Create: `__tests__/push-client-site.test.ts`
- Test: `__tests__/PushFollowsContext.test.tsx`

**Interfaces:**
- Consumes: the routes from Task 7.
- Produces:
  - `PushClient.state(endpoint): Promise<{ follows: PushFollow[]; site: boolean } | null>`
  - `PushClient.setSite(subscription: PushSubscriptionJSON, lang: Lang, on: boolean): Promise<{ follows: PushFollow[]; site: boolean } | { error: string; reason?: string }>`
  - `PushFollowsValue.siteNews: boolean` and `PushFollowsValue.setSiteNews(on: boolean): Promise<FollowOutcome>`

- [ ] **Step 1: Write the failing tests**

`__tests__/push-client.test.ts` only covers the pure helpers and has no fetch
harness, so the two new client methods get their own file. Create
`__tests__/push-client-site.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { browserPushClient } from '@/lib/push/client'

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }
const calls: Array<{ url: string; body: unknown }> = []

const answers = (status: number, body: unknown) => {
  global.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return { ok: status === 200, status, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => { calls.length = 0 })

describe('browserPushClient.setSite', () => {
  it('posts the subscription, the language and the switch', async () => {
    answers(200, { follows: [], site: true })
    expect(await browserPushClient.setSite(SUB, 'th', true)).toEqual({ follows: [], site: true })
    expect(calls[0].url).toBe('/api/push/site')
    expect(calls[0].body).toEqual({ subscription: SUB, lang: 'th', on: true })
  })

  it('reports a refusal the caller can act on', async () => {
    answers(429, { error: 'too many', reason: 'device-limit' })
    expect(await browserPushClient.setSite(SUB, 'en', true)).toEqual({ error: 'too many', reason: 'device-limit' })
  })

  it('survives a network failure', async () => {
    global.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await browserPushClient.setSite(SUB, 'en', true)).toEqual({ error: 'network' })
  })
})

describe('browserPushClient.state', () => {
  it('gives the follows and the switch together', async () => {
    answers(200, { follows: [{ kind: 'club' }], site: true })
    expect(await browserPushClient.state(SUB.endpoint)).toEqual({ follows: [{ kind: 'club' }], site: true })
  })

  it('defaults the switch to off when the server does not say', async () => {
    answers(200, { follows: [] })
    expect(await browserPushClient.state(SUB.endpoint)).toEqual({ follows: [], site: false })
  })

  it('is null when the server refuses', async () => {
    answers(404, { error: 'nope' })
    expect(await browserPushClient.state(SUB.endpoint)).toBeNull()
  })
})
```

In `__tests__/PushFollowsContext.test.tsx`:

```ts
  it('switches site news on, subscribing the device on the way', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    expect(value.siteNews).toBe(false)
    await act(async () => { expect(await value.setSiteNews(true)).toBe('ok') })
    expect(value.siteNews).toBe(true)
    expect(client.calls).toContain('subscribe')
    await act(async () => { await value.setSiteNews(false) })
    expect(value.siteNews).toBe(false)
  })

  it('reports the switch the server already holds for this device', async () => {
    const client = fakeClient({
      currentSubscription: async () => SUB,
      state: async () => ({ follows: [], site: true }),
    })
    mount(client)
    await waitFor(() => expect(value.siteNews).toBe(true))
  })

  it('does not switch site news on when notifications are blocked', async () => {
    const client = fakeClient({ permission: () => 'denied' })
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    await act(async () => { expect(await value.setSiteNews(true)).toBe('denied') })
    expect(value.siteNews).toBe(false)
  })
```

Its other tests call `client.state` through the provider; any that assert on an
array from `state` need their expectation changed to the `{ follows, site }`
object.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest __tests__/push-client-site.test.ts __tests__/PushFollowsContext.test.tsx`
Expected: FAIL — `setSite` / `siteNews` do not exist.

- [ ] **Step 3: Implement the client**

In `lib/push/client.ts`, change `state` in the `PushClient` interface and add `setSite`:

```ts
  state(endpoint: string): Promise<{ follows: PushFollow[]; site: boolean } | null>
  /** Turns the site-news switch on or off for this device. */
  setSite(subscription: PushSubscriptionJSON, lang: Lang, on: boolean): Promise<{ follows: PushFollow[]; site: boolean } | { error: string; reason?: string }>
```

and in `browserPushClient`:

```ts
  async setSite(subscription, lang, on) {
    try {
      const { status, data } = await postJson('/api/push/site', { subscription, lang, on })
      const d = (data ?? {}) as { follows?: PushFollow[]; site?: boolean; error?: string; reason?: string }
      if (status === 200 && Array.isArray(d.follows)) return { follows: d.follows, site: d.site === true }
      return { error: d.error ?? `HTTP ${status}`, ...(d.reason && { reason: d.reason }) }
    } catch {
      return { error: 'network' }
    }
  },
  async state(endpoint) {
    try {
      const { status, data } = await postJson('/api/push/state', { endpoint })
      const d = (data ?? {}) as { follows?: PushFollow[]; site?: boolean }
      return status === 200 && Array.isArray(d.follows) ? { follows: d.follows, site: d.site === true } : null
    } catch {
      return null
    }
  },
```

- [ ] **Step 4: Implement the fake client**

In `lib/push/fake-client.ts`, add `site` to its remembered server state:

```ts
  let site = false
```

and replace its `state`, adding `setSite`:

```ts
    setSite: async (_s, lang, on) => { calls.push(`setSite:${lang}:${on}`); site = on; return { follows: server, site } },
    state: async () => { calls.push('state'); return { follows: server, site } },
```

- [ ] **Step 5: Implement the context**

In `lib/push/PushFollowsContext.tsx`: add to `PushFollowsValue`

```ts
  /** Whether this device asked to be told about new tournaments, draws and schedules. */
  siteNews: boolean
  setSiteNews(on: boolean): Promise<FollowOutcome>
```

add `siteNews: false, setSiteNews: async () => 'error',` to `OFF`, add the state

```ts
  const [siteNews, setSiteNewsState] = useState(false)
```

update the load effect's last lines:

```ts
      const known = await client.state(sub.endpoint)
      if (!live || !known) return
      setFollows(known.follows)
      setSiteNewsState(known.site)
```

add the callback beside `follow`:

```ts
  const setSiteNews = useCallback(async (on: boolean): Promise<FollowOutcome> => {
    const key = keyRef.current
    if (!key || client.environment() !== 'ok') return 'error'
    if (client.permission() === 'denied') { setPermission('denied'); return 'denied' }
    const sub = await client.subscribe(key)
    setPermission(client.permission())
    if (sub === 'denied' || sub === 'dismissed') return sub
    if (!sub) return 'error'
    const result = await client.setSite(sub, lang, on)
    if ('follows' in result) {
      setFollows(result.follows)
      setSiteNewsState(result.site)
      return 'ok'
    }
    return result.reason ? 'limit' : 'error'
  }, [client, lang])
```

and add `siteNews`, `setSiteNews` to the `useMemo` value and its dependency array.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/push-client-site.test.ts __tests__/PushFollowsContext.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/push/client.ts lib/push/fake-client.ts lib/push/PushFollowsContext.tsx __tests__/push-client-site.test.ts __tests__/PushFollowsContext.test.tsx
git commit -m "feat(push): site-news switch in the browser client and context"
```

---

### Task 9: The switch in the bell panel

**Files:**
- Create: `components/SiteNewsSwitch.tsx`
- Modify: `lib/i18n.ts` (two keys, both languages)
- Modify: `app/page.tsx:1236` (the `following` prop)
- Test: `__tests__/SiteNewsSwitch.test.tsx`

**Interfaces:**
- Consumes: `usePushFollows()` with `siteNews` / `setSiteNews` (Task 8).
- Produces: `export default function SiteNewsSwitch(): JSX.Element | null`

No change to `components/AlertBell.tsx`: its `hasFollowing` prop is already passed as `pushFollows.status === 'ok'` (`app/page.tsx:1235`), which is exactly when the switch renders, so the panel already opens for it.

- [ ] **Step 1: Write the failing test**

Create `__tests__/SiteNewsSwitch.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import SiteNewsSwitch from '@/components/SiteNewsSwitch'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import { fakeClient } from '@/lib/push/fake-client'
import type { PushClient } from '@/lib/push/client'

const mount = (client: PushClient) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><SiteNewsSwitch /></PushFollowsProvider></LanguageProvider>)

describe('SiteNewsSwitch', () => {
  it('renders nothing where push cannot work', () => {
    const { container } = mount(fakeClient({ environment: () => 'unsupported' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('switches on when clicked', async () => {
    const client = fakeClient()
    mount(client)
    const box = await waitFor(() => screen.getByRole('checkbox'))
    expect(box).not.toBeChecked()
    await act(async () => { fireEvent.click(box) })
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
    expect(client.calls.some((c) => c.startsWith('setSite:'))).toBe(true)
  })

  it('shows the blocked note and stays off when notifications are denied', async () => {
    mount(fakeClient({ permission: () => 'denied' }))
    const box = await waitFor(() => screen.getByRole('checkbox'))
    await act(async () => { fireEvent.click(box) })
    await waitFor(() => expect(screen.getByText(/blocked|ถูกปิด/i)).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
```

`@testing-library/jest-dom` is already loaded for every test by
`jest.setup.ts`, so `toBeChecked()` and `toBeInTheDocument()` work.
`@testing-library/user-event` is **not** a dependency — hence `fireEvent`. Do
not add a dependency for this test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/SiteNewsSwitch.test.tsx`
Expected: FAIL — cannot find module `@/components/SiteNewsSwitch`.

- [ ] **Step 3: Add the copy**

In `lib/i18n.ts`, add two keys to the `TranslationKey` union, beside `'followingTitle'`:

```ts
  | 'siteNewsTitle'
  | 'siteNewsNote'
```

In the `en` block, beside `followingTitle`:

```ts
    siteNewsTitle: 'New tournaments, draws & schedules',
    siteNewsNote: 'Be told when a tournament is listed, when its draws are out, and when its schedule is published.',
```

In the `th` block, beside its `followingTitle`:

```ts
    siteNewsTitle: 'ทัวร์นาเมนต์ สาย และตารางใหม่',
    siteNewsNote: 'รับแจ้งเตือนเมื่อมีทัวร์นาเมนต์ใหม่ เมื่อสายการแข่งขันออก และเมื่อตารางแข่งเผยแพร่',
```

- [ ] **Step 4: Implement the switch**

Create `components/SiteNewsSwitch.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'

/** One switch for everything newly published on the site: a tournament, its
 *  draws, its schedule. Unlike a follow it names no tournament, so it is the
 *  panel's own row rather than part of the Following list. Renders nothing
 *  where push cannot work, as FollowingList does. */
export default function SiteNewsSwitch() {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [problem, setProblem] = useState<'denied' | 'error' | null>(null)
  if (push.status !== 'ok') return null

  const toggle = async () => {
    const on = !push.siteNews
    const outcome = await push.setSiteNews(on)
    if (outcome === 'ok') {
      setProblem(null)
      track('site_news_toggled', { on })
      return
    }
    setProblem(outcome === 'denied' ? 'denied' : 'error')
  }

  return (
    <div className="following">
      <label className="following-row" style={{ cursor: 'pointer' }}>
        <span>
          <span>{t('siteNewsTitle')}</span>
          <span className="following-where"> · {t('siteNewsNote')}</span>
        </span>
        <input
          type="checkbox"
          checked={push.siteNews}
          onChange={() => void toggle()}
          aria-label={t('siteNewsTitle')}
        />
      </label>
      {problem && <div className="following-where">{t('followBlocked')}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Mount it in the bell panel**

In `app/page.tsx`, replace the `following` prop at line 1236 with:

```tsx
              following={<><SiteNewsSwitch /><FollowingList tournamentNames={tournamentNames} /></>}
```

and add the import beside the `FollowingList` one at line 13:

```tsx
import SiteNewsSwitch from '@/components/SiteNewsSwitch'
```

- [ ] **Step 6: Run the test, the suite, and the build**

Run: `npx jest __tests__/SiteNewsSwitch.test.tsx`
Expected: PASS.

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.

- [ ] **Step 7: Verify it by hand in the running app**

Start the dev server, open the bell, switch site news on, and confirm the browser asks for notification permission and `.cache/push/subscriptions.json` grows a record with `"site": true`. Then confirm the first pass seeds instead of flooding: delete `.cache/push/published.json`, watch one pass go by, and check that the file now lists the current tournaments and that no notification arrived.

```bash
rm -f .cache/push/published.json
```

- [ ] **Step 8: Commit**

```bash
git add components/SiteNewsSwitch.tsx lib/i18n.ts app/page.tsx __tests__/SiteNewsSwitch.test.tsx
git commit -m "feat(push): site-news switch in the notifications panel"
```
