# Match Alerts (web push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person follows a player or a whole club in a BAT tournament and gets a web push notification when a followed match is about three matches from going on court, and again when it is next.

**Architecture:** A pure decision function turns a day's schedule, the stored follows and a sent log into the alerts that are due. A once-a-minute watcher, run only by the leader worker, feeds it the schedule through the app's own matches route and sends through a `web-push` sender. The browser side is a push-only service worker, a small client library, a React context for follows, and three small controls.

**Tech Stack:** Next.js 14 (app router), React 18, TypeScript, Jest + Testing Library, `web-push` (new), Node 20 on the server.

**Spec:** `docs/superpowers/specs/2026-10-09-match-alerts-design.md`

## Global Constraints

- BAT tournaments only. Time-slot schedules only: a match with no queue position is never alerted.
- The watcher never asks BAT for anything itself. It reads the schedule through `/api/matches` on the local origin, without `fresh=1`, and reads club membership from what is already held.
- Nothing is sent while `batDownSince()` reports an outage.
- Only the worker holding the leader lease sends.
- With `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` or `VAPID_SUBJECT` missing, the feature is off: `GET /api/push/key` is 404, no follow control is shown, the watcher does not start.
- A push endpoint is accepted only on `fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com` or `*.notify.windows.com`, over `https:`.
- Limits: 50 followed players and 10 followed clubs per device, 5,000 devices. A device not seen for 60 days is removed.
- A follow is accepted only for a BAT tournament in the site's registry (`listAllTournaments()`), and the watcher asks only about registry tournaments that are not finished. `resolveRef` is not used for this: it treats any unknown id as BAT.
- Pushes are sent with `urgency: 'high'` and `TTL: 600`.
- The service worker handles `push` and `notificationclick` only. It never caches a page or an asset.
- The notification permission prompt is shown only after a tap on a follow control, never on page load.
- Every user-visible string has `en` and `th` entries in `lib/i18n.ts` and a key in `TKey`. Notification text is built on the server in the device's language.
- Match the surrounding code: no semicolons, single quotes, two-space indent, `@/` import alias.
- Tests: `npx jest <file>`; the whole suite `npx jest --roots '<rootDir>/__tests__'` (bare `npm test` also crawls `.claude/worktrees/`). `npx tsc --noEmit` has one known error in `__tests__/tournamentStats.test.ts:955`; "clean" means no others.
- Never commit `public/bwf-cache.json`.

## Facts the plan relies on (verified in the repo)

- `computePlayingOrder({ groups, liveByCourt })` in `lib/playingOrder.ts` returns `Map<"${gi}-${mi}", position>` (1-based) for matches still to be played; live, finished and walkover matches and whole `type: 'court'` groups are left out.
- `MatchScheduleGroup` is `{ type: 'time', time, matches } | { type: 'court', court, matches }`. `MatchEntry` has `draw`, `drawNum`, `round`, `team1`, `team2` (`MatchPlayer[]` with `name`, `playerId`), `winner`, `walkover`, `nowPlaying`, `court`.
- `GET /api/matches?tournament=ID` returns `MatchesData` (`days: { date, label, dateIso }[]`, `groups`). `&date=<day.date>` returns that day's `groups`. `day.date` is BAT's own form (e.g. `25691009`).
- `playerClubCache` in `lib/bracket-cache.ts` is a `Map` keyed `` `${tournamentIdLowerCase}:${playerId}` `` → club name. `readClubsCache(tournamentId)` in `lib/clubs-cache.ts` returns `Record<playerId, club> | null` from disk (written by the hourly index rebuild).
- `batDownSince()` in `lib/bat-outages.ts` returns an ISO string during an outage, else `null`.
- `resolveRef(id)` in `lib/tournaments-registry.ts` returns `{ id, provider }` and defaults an unknown id to `bat`; `listAllTournaments()` returns `RegistryEntry[]` with `id` (upper-case) and `provider`.
- `instrumentation.ts` holds a leader flag `amLeader`, renewed every 20 s, after the `renewLease` setup.
- The page opens a tournament from `/?tournament=<id>` (`app/page.tsx`, the `url.searchParams.get('tournament')` block). There is no URL form for a day, so a notification opens the tournament, which shows today's schedule by default; the spec's "that tournament and day" is met that way and no day parameter is added.
- `RosterModal` renders its `title` inside one heading line (`{title} · {count} players`). `ClubRosterModal` is rendered by `TournamentStatsPanel`, which has a `tournamentId` prop.
- Providers are mounted in `app/layout.tsx` inside `<PresenceProvider>`.
- `web-push` is at 3.6.7 and `@types/web-push` at 3.6.4. The server runs Node 20.

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/push/types.ts` (create) | Shared types: follows, records, due alerts, payload |
| `lib/push/alerts.ts` (create) | `dueAlerts`, `matchKey`, `normalizeClub`, `sentKeyFor` |
| `lib/push/text.ts` (create) | Notification title, body, digest, in both languages |
| `lib/push/store.ts` (create) | Subscription records on disk |
| `lib/push/sent-log.ts` (create) | Which alerts were already sent |
| `lib/push/config.ts` (create) | VAPID settings from the environment |
| `lib/push/validate.ts` (create) | Endpoint, GUID and target validation |
| `lib/push/clubs.ts` (create) | Club membership lookup for a tournament |
| `lib/push/sender.ts` (create) | The `web-push` sender |
| `lib/push/stats.ts` (create) | Sent and failed counts for the day |
| `lib/push/watcher.ts` (create) | The once-a-minute tick and its timer |
| `app/api/push/{key,follow,unfollow,state}/route.ts` (create) | API |
| `public/sw.js` (create) | Push-only service worker |
| `lib/push/client.ts` (create) | Browser side: environment, subscribe, API calls |
| `lib/push/PushFollowsContext.tsx` (create) | React context for follows |
| `lib/push/fake-client.ts` (create) | Test stand-in for the browser side |
| `components/FollowButton.tsx`, `FollowClubButton.tsx`, `FollowingList.tsx` (create) | Controls |
| `components/PlayerModal.tsx`, `ClubRosterModal.tsx`, `TournamentStatsPanel.tsx`, `AlertBell.tsx`, `app/page.tsx`, `app/layout.tsx` (modify) | Wiring |
| `instrumentation.ts`, `next.config.js`, `app/api/bmstats/route.ts`, `components/BmStats.tsx` (modify) | Start, headers, status page |
| `lib/i18n.ts`, `lib/privacy.ts`, `.env.example`, `DEPLOY.md` (modify) | Strings, notice, setup |

## Review Focus

1. **A schedule re-read that moves a match backwards** (organisers reorder; position 1 → 3). An alert already sent must not be sent again, and `soon` must not arrive after `next`. (Task 2.)
2. **A doubles match where the device follows one partner and the other partner's club.** One alert, both names, no duplicate. (Task 2.)
3. **The store file is corrupt or half-written** (power loss during a write). The feature must keep working from empty rather than crash every request. (Task 3.)
4. **A send that fails for one device must not stop the tick for the others**, and a `gone` answer must remove only that device. (Task 6.)
5. **A person taps follow, then denies the permission prompt.** Nothing may be stored on the server, and the button must explain what happened instead of silently doing nothing. (Task 8.)

---

### Task 1: Types and notification text

**Files:**
- Create: `lib/push/types.ts`, `lib/push/text.ts`
- Test: `__tests__/push-text.test.ts`

**Interfaces:**
- Consumes: `MatchEntry`, `MatchPlayer` from `@/lib/types`; `abbrevRoundL`, `Lang` from `@/lib/i18n`.
- Produces: everything in `lib/push/types.ts` below, and
  ```ts
  export function alertPayload(alert: DueAlert, tournamentId: string): PushPayload
  export function digestPayload(alerts: DueAlert[], tournamentId: string, minuteKey: string): PushPayload
  ```

- [ ] **Step 1: Write the types**

Create `lib/push/types.ts`:

```ts
import type { MatchEntry, MatchPlayer } from '@/lib/types'
import type { Lang } from '@/lib/i18n'

export interface PlayerFollow {
  kind: 'player'
  /** Upper-case GUID. */
  tournamentId: string
  /** BAT's tournament-local player id. */
  playerId: string
  /** As shown when followed, for the list. */
  playerName: string
  addedAt: string
}

export interface ClubFollow {
  kind: 'club'
  /** Upper-case GUID. */
  tournamentId: string
  /** As BAT prints it in this tournament. */
  clubName: string
  addedAt: string
}

export type PushFollow = PlayerFollow | ClubFollow

/** What a follow or unfollow request names. */
export type FollowTarget =
  | { kind: 'player'; tournamentId: string; playerId: string; playerName?: string }
  | { kind: 'club'; tournamentId: string; clubName: string }

export interface PushKeys {
  p256dh: string
  auth: string
}

export interface PushSubscriptionRecord {
  /** The push service address; the record's key. */
  endpoint: string
  keys: PushKeys
  lang: Lang
  follows: PushFollow[]
  createdAt: string
  /** Refreshed whenever the device talks to the API. */
  lastSeenAt: string
}

export type Stage = 'soon' | 'next'

export interface DueAlert {
  endpoint: string
  lang: Lang
  stage: Stage
  /** 1-based place in the queue when decided. */
  position: number
  sentKey: string
  /** Every sent key this alert settles: its own, plus `soon` when it is `next`. */
  covers: string[]
  match: MatchEntry
  /** The players in the match this device follows, directly or through a club. */
  players: MatchPlayer[]
  /** The followed clubs that brought the match in. */
  clubs: string[]
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/push-text.test.ts`:

```ts
import { alertPayload, digestPayload } from '@/lib/push/text'
import type { DueAlert } from '@/lib/push/types'
import type { MatchEntry, MatchPlayer } from '@/lib/types'

const P = (name: string, playerId: string): MatchPlayer => ({ name, playerId })
const TID = 'AAAAAAAA-0000-0000-0000-000000000001'

const match = (over: Partial<MatchEntry> = {}): MatchEntry => ({
  draw: 'BS U15', drawNum: '21', round: 'Round of 32',
  team1: [P('Anan Dee', '1')], team2: [P('Beam Kla', '2')],
  winner: null, scores: [], court: 'Court 4', walkover: false, retired: false, nowPlaying: false,
  ...over,
})

const alert = (over: Partial<DueAlert> = {}): DueAlert => {
  const m = over.match ?? match()
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/x', lang: 'en', stage: 'next', position: 1,
    sentKey: 'k', covers: ['k'], match: m, players: [m.team1[0]], clubs: [], ...over,
  }
}

describe('alertPayload', () => {
  it('says "Up next" with the player first, the opponent, the draw, round and court', () => {
    const p = alertPayload(alert(), TID)
    expect(p.title).toBe('Up next')
    expect(p.body).toBe('Anan Dee vs Beam Kla · BS U15 R32 · Court 4')
    expect(p.url).toBe(`/?tournament=${TID}`)
  })

  it('puts the followed side first even when it is listed second', () => {
    const m = match()
    expect(alertPayload(alert({ match: m, players: [m.team2[0]] }), TID).body)
      .toBe('Beam Kla vs Anan Dee · BS U15 R32 · Court 4')
  })

  it('counts how far away the early alert is from the queue position', () => {
    expect(alertPayload(alert({ stage: 'soon', position: 4 }), TID).title).toBe('About 3 matches away')
    expect(alertPayload(alert({ stage: 'soon', position: 3 }), TID).title).toBe('About 2 matches away')
    expect(alertPayload(alert({ stage: 'soon', position: 2 }), TID).title).toBe('About 1 match away')
  })

  it('leaves the court out when the schedule has none', () => {
    expect(alertPayload(alert({ match: match({ court: '' }) }), TID).body).toBe('Anan Dee vs Beam Kla · BS U15 R32')
  })

  it('names both partners of a doubles pair', () => {
    const m = match({ draw: 'BD U15', team1: [P('Anan Dee', '1'), P('Krit Wong', '9')], team2: [P('Beam Kla', '2'), P('Chai Yo', '3')] })
    expect(alertPayload(alert({ match: m, players: [m.team1[1]] }), TID).body)
      .toBe('Anan Dee / Krit Wong vs Beam Kla / Chai Yo · BD U15 R32 · Court 4')
  })

  it('keeps the page order when both sides are followed', () => {
    const m = match()
    expect(alertPayload(alert({ match: m, players: [m.team2[0], m.team1[0]] }), TID).body)
      .toBe('Anan Dee vs Beam Kla · BS U15 R32 · Court 4')
  })

  it('is written in Thai for a Thai device', () => {
    expect(alertPayload(alert({ lang: 'th' }), TID).title).toBe('คู่ต่อไป')
    expect(alertPayload(alert({ lang: 'th', stage: 'soon', position: 4 }), TID).title).toBe('อีกประมาณ 3 คู่')
    expect(alertPayload(alert({ lang: 'th' }), TID).body).toContain(' พบ ')
  })

  it('uses one tag per match, so "next" replaces "soon" on the device', () => {
    const soon = alertPayload(alert({ stage: 'soon', position: 3 }), TID)
    const next = alertPayload(alert({ stage: 'next' }), TID)
    expect(soon.tag).toBe(next.tag)
    expect(alertPayload(alert({ match: match({ drawNum: '22' }) }), TID).tag).not.toBe(next.tag)
  })
})

describe('digestPayload', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    alert({
      position: n - i, stage: n - i === 1 ? 'next' : 'soon',
      match: match({ team1: [P(`Player ${i}`, String(100 + i))], court: `Court ${i}` }),
    }))

  it('counts the matches and lists the nearest first', () => {
    const p = digestPayload(many(3), TID, '2026-10-09T10:15')
    expect(p.title).toBe('3 matches coming up')
    expect(p.body.split('\n')).toEqual([
      'Player 2 · BS U15 · Court 2',
      'Player 1 · BS U15 · Court 1',
      'Player 0 · BS U15 · Court 0',
    ])
  })

  it('lists four and counts the rest', () => {
    const lines = digestPayload(many(7), TID, '2026-10-09T10:15').body.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[4]).toBe('+3 more')
  })

  it('lists exactly four without a remainder line', () => {
    expect(digestPayload(many(4), TID, '2026-10-09T10:15').body.split('\n')).toHaveLength(4)
  })

  it('is written in the first alert\'s language', () => {
    const th = many(7).map((a) => ({ ...a, lang: 'th' as const }))
    const p = digestPayload(th, TID, '2026-10-09T10:15')
    expect(p.title).toBe('อีก 7 คู่ใกล้ถึงคิว')
    expect(p.body.split('\n')[4]).toBe('+อีก 3 คู่')
  })

  it('has a tag of its own, per tournament and minute', () => {
    const p = digestPayload(many(3), TID, '2026-10-09T10:15')
    expect(p.tag).toBe(`${TID}|2026-10-09T10:15`)
    expect(p.url).toBe(`/?tournament=${TID}`)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest __tests__/push-text.test.ts`
Expected: FAIL — cannot find module `@/lib/push/text`.

- [ ] **Step 4: Implement**

Create `lib/push/text.ts`:

```ts
import type { MatchEntry, MatchPlayer } from '@/lib/types'
import { abbrevRoundL, type Lang } from '@/lib/i18n'
import type { DueAlert, PushPayload } from './types'

const names = (team: MatchPlayer[]) => team.map((p) => p.name).join(' / ')

/** The match's stable name on a device: `next` replaces `soon` under it. */
export function matchTag(m: MatchEntry): string {
  const ids = [...m.team1, ...m.team2].map((p) => p.playerId || p.name).sort().join(',')
  return `${m.drawNum}|${ids}`
}

function title(alert: DueAlert): string {
  if (alert.stage === 'next') return alert.lang === 'th' ? 'คู่ต่อไป' : 'Up next'
  const n = Math.max(1, alert.position - 1)
  if (alert.lang === 'th') return `อีกประมาณ ${n} คู่`
  return n === 1 ? 'About 1 match away' : `About ${n} matches away`
}

/** Both sides of the match, the followed one first. When both are followed,
 *  or neither can be told, the page's own order stands. */
function sides(alert: DueAlert): [MatchPlayer[], MatchPlayer[]] {
  const { team1, team2 } = alert.match
  const mine = new Set(alert.players.map((p) => p.playerId || p.name))
  const has = (team: MatchPlayer[]) => team.some((p) => mine.has(p.playerId || p.name))
  return has(team2) && !has(team1) ? [team2, team1] : [team1, team2]
}

const urlFor = (tournamentId: string) => `/?tournament=${tournamentId}`

export function alertPayload(alert: DueAlert, tournamentId: string): PushPayload {
  const lang: Lang = alert.lang
  const [a, b] = sides(alert)
  const versus = lang === 'th' ? 'พบ' : 'vs'
  const m = alert.match
  const parts = [`${names(a)} ${versus} ${names(b)}`, `${m.draw} ${abbrevRoundL(m.round, lang)}`.trim()]
  if (m.court) parts.push(m.court)
  return { title: title(alert), body: parts.join(' · '), url: urlFor(tournamentId), tag: matchTag(m) }
}

const DIGEST_LINES = 4

/** Several alerts for one device in one tick, as a single notification: the
 *  nearest match first, a few lines, then a count of the rest. */
export function digestPayload(alerts: DueAlert[], tournamentId: string, minuteKey: string): PushPayload {
  const lang: Lang = alerts[0]?.lang ?? 'en'
  const sorted = alerts.slice().sort((x, y) => x.position - y.position)
  const lines = sorted.slice(0, DIGEST_LINES).map((a) => {
    const parts = [names(a.players.length > 0 ? a.players : a.match.team1), a.match.draw]
    if (a.match.court) parts.push(a.match.court)
    return parts.join(' · ')
  })
  const rest = sorted.length - DIGEST_LINES
  if (rest > 0) lines.push(lang === 'th' ? `+อีก ${rest} คู่` : `+${rest} more`)
  return {
    title: lang === 'th' ? `อีก ${sorted.length} คู่ใกล้ถึงคิว` : `${sorted.length} matches coming up`,
    body: lines.join('\n'),
    url: urlFor(tournamentId),
    tag: `${tournamentId}|${minuteKey}`,
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest __tests__/push-text.test.ts`
Expected: PASS, 13 tests.

If the round reads other than `R32`, read `abbrevRoundL` in `lib/i18n.ts` and change the expected strings in this test file to what it returns for `'Round of 32'`. Do not change `abbrevRoundL`.

- [ ] **Step 6: Commit**

```bash
git add lib/push/types.ts lib/push/text.ts __tests__/push-text.test.ts
git commit -m "feat(alerts): types and notification text for match alerts"
```

---

### Task 2: The alert decision

**Files:**
- Create: `lib/push/alerts.ts`
- Test: `__tests__/push-alerts.test.ts`

**Interfaces:**
- Consumes: `computePlayingOrder` from `@/lib/playingOrder`; types from Task 1; `matchTag` from `@/lib/push/text`.
- Produces:
  ```ts
  export function normalizeClub(name: string | undefined | null): string
  export function endpointHash(endpoint: string): string
  export function sentKeyFor(endpoint: string, tournamentId: string, dateIso: string, match: MatchEntry, stage: Stage): string
  export function dueAlerts(input: {
    tournamentId: string
    dateIso: string
    groups: MatchScheduleGroup[]
    records: PushSubscriptionRecord[]
    clubOf: (playerId: string) => string | undefined
    alreadySent: (key: string) => boolean
  }): DueAlert[]
  ```

- [ ] **Step 1: Write the failing test**

Create `__tests__/push-alerts.test.ts`:

```ts
import { dueAlerts, normalizeClub, sentKeyFor, endpointHash } from '@/lib/push/alerts'
import type { PushFollow, PushSubscriptionRecord } from '@/lib/push/types'
import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from '@/lib/types'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const DAY = '2026-10-09'
const P = (id: string): MatchPlayer => ({ name: `P${id}`, playerId: id })

const m = (a: string[], b: string[], over: Partial<MatchEntry> = {}): MatchEntry => ({
  draw: 'BS U15', drawNum: '21', round: 'Round of 32',
  team1: a.map(P), team2: b.map(P),
  winner: null, scores: [], court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
  ...over,
})

/** One time-slot group; the queue is the order given. */
const day = (...matches: MatchEntry[]): MatchScheduleGroup[] => [{ type: 'time', time: '9:00', matches }]

const player = (playerId: string): PushFollow =>
  ({ kind: 'player', tournamentId: TID, playerId, playerName: `P${playerId}`, addedAt: '' })
const club = (clubName: string): PushFollow => ({ kind: 'club', tournamentId: TID, clubName, addedAt: '' })

const device = (name: string, follows: PushFollow[], lang: 'en' | 'th' = 'en'): PushSubscriptionRecord => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: 'p', auth: 'a' }, lang, follows, createdAt: '', lastSeenAt: '',
})

const decide = (
  groups: MatchScheduleGroup[],
  records: PushSubscriptionRecord[],
  over: { sent?: Set<string>; clubs?: Record<string, string> } = {},
) => dueAlerts({
  tournamentId: TID, dateIso: DAY, groups, records,
  clubOf: (id) => over.clubs?.[id],
  alreadySent: (k) => over.sent?.has(k) ?? false,
})

const brief = (alerts: ReturnType<typeof decide>) =>
  alerts.map((a) => `${a.endpoint.split('/').pop()}:${a.stage}:${a.match.team1[0].playerId}v${a.match.team2[0].playerId}@${a.position}`)

// A played match first, so the queue starts after it.
const DONE = m(['90'], ['91'], { winner: 1 })
const queue = () => day(DONE, m(['1'], ['2']), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8']), m(['9'], ['10']), m(['11'], ['12']))

describe('dueAlerts — when', () => {
  it('is "next" at the front of the queue', () => {
    expect(brief(decide(queue(), [device('a', [player('1')])]))).toEqual(['a:next:1v2@1'])
  })

  it('is "soon" at two, three and four places from the front', () => {
    expect(brief(decide(queue(), [device('a', [player('3')])]))).toEqual(['a:soon:3v4@2'])
    expect(brief(decide(queue(), [device('a', [player('5')])]))).toEqual(['a:soon:5v6@3'])
    expect(brief(decide(queue(), [device('a', [player('7')])]))).toEqual(['a:soon:7v8@4'])
  })

  it('is nothing further back', () => {
    expect(decide(queue(), [device('a', [player('9'), player('11')])])).toEqual([])
  })

  it('never alerts a finished, walked-over or now-playing match', () => {
    const groups = day(m(['1'], ['2'], { winner: 2 }), m(['3'], ['4'], { walkover: true, winner: 1 }), m(['5'], ['6'], { nowPlaying: true }))
    expect(decide(groups, [device('a', [player('1'), player('3'), player('5')])])).toEqual([])
  })

  it('never alerts a court-sequenced day', () => {
    const groups: MatchScheduleGroup[] = [{ type: 'court', court: 'Court 1', matches: [m(['1'], ['2'])] }]
    expect(decide(groups, [device('a', [player('1')])])).toEqual([])
  })

  it('is nothing for an empty day or with nobody following', () => {
    expect(decide([], [device('a', [player('1')])])).toEqual([])
    expect(decide(queue(), [])).toEqual([])
    expect(decide(queue(), [device('a', [])])).toEqual([])
  })

  it('ignores follows in another tournament', () => {
    const other: PushFollow = { kind: 'player', tournamentId: 'BBBBBBBB-0000-0000-0000-000000000002', playerId: '1', playerName: 'P1', addedAt: '' }
    expect(decide(queue(), [device('a', [other])])).toEqual([])
  })

  it('matches the tournament id whatever its case', () => {
    const lower = { ...player('1'), tournamentId: TID.toLowerCase() } as PushFollow
    expect(brief(decide(queue(), [device('a', [lower])]))).toEqual(['a:next:1v2@1'])
  })
})

describe('dueAlerts — once', () => {
  it('does not repeat an alert already sent', () => {
    const a = device('a', [player('3')])
    const first = decide(queue(), [a])
    expect(first).toHaveLength(1)
    expect(decide(queue(), [a], { sent: new Set(first.flatMap((x) => x.covers)) })).toEqual([])
  })

  it('sends "next" after "soon" was sent', () => {
    const a = device('a', [player('3')])
    const soon = decide(queue(), [a])
    const sent = new Set(soon.flatMap((x) => x.covers))
    const later = day(DONE, m(['1'], ['2'], { winner: 1 }), m(['3'], ['4']), m(['5'], ['6']))
    expect(brief(decide(later, [a], { sent }))).toEqual(['a:next:3v4@1'])
  })

  it('a match first seen at the front settles "soon" too, so it cannot arrive afterwards', () => {
    const a = device('a', [player('1')])
    const next = decide(queue(), [a])
    expect(next[0].covers).toHaveLength(2)
    const sent = new Set(next.flatMap((x) => x.covers))
    // the organisers push the match back three places
    const reordered = day(DONE, m(['3'], ['4']), m(['5'], ['6']), m(['1'], ['2']))
    expect(decide(reordered, [a], { sent })).toEqual([])
  })

  it('keeps a key stable when the schedule is re-read in another order', () => {
    const one = sentKeyFor('https://e/1', TID, DAY, m(['1'], ['2']), 'next')
    const two = sentKeyFor('https://e/1', TID.toLowerCase(), DAY, m(['2'], ['1']), 'next')
    expect(one).toBe(two)
    expect(sentKeyFor('https://e/2', TID, DAY, m(['1'], ['2']), 'next')).not.toBe(one)
    expect(sentKeyFor('https://e/1', TID, DAY, m(['1'], ['2']), 'soon')).not.toBe(one)
    expect(sentKeyFor('https://e/1', TID, '2026-10-10', m(['1'], ['2']), 'next')).not.toBe(one)
    expect(one).not.toContain('https://')
    expect(endpointHash('https://e/1')).toHaveLength(16)
  })
})

describe('dueAlerts — who', () => {
  it('sends each device its own alert', () => {
    const out = decide(queue(), [device('a', [player('1')]), device('b', [player('2')]), device('c', [player('5')])])
    expect(brief(out).sort()).toEqual(['a:next:1v2@1', 'b:next:1v2@1', 'c:soon:5v6@3'])
  })

  it('names two followed players in one match together, in one alert', () => {
    const out = decide(queue(), [device('a', [player('1'), player('2')])])
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['1', '2'])
  })

  it('finds a doubles pair by either partner', () => {
    const groups = day(DONE, m(['1', '9'], ['2', '8']))
    expect(decide(groups, [device('a', [player('9')])])[0].players.map((p) => p.playerId)).toEqual(['9'])
  })

  it('carries the device language', () => {
    expect(decide(queue(), [device('a', [player('1')], 'th')])[0].lang).toBe('th')
  })
})

describe('dueAlerts — clubs', () => {
  const clubs = { '1': 'Red Club', '3': 'Red Club', '4': 'Blue Club', '9': 'Red  club ' }

  it('brings in every member\'s match', () => {
    const out = decide(queue(), [device('a', [club('Red Club')])], { clubs })
    expect(brief(out).sort()).toEqual(['a:next:1v2@1', 'a:soon:3v4@2'])
    expect(out[0].clubs).toEqual(['Red Club'])
  })

  it('compares club names without regard to case or spacing', () => {
    const groups = day(DONE, m(['9'], ['10']))
    expect(decide(groups, [device('a', [club('red club')])], { clubs })).toHaveLength(1)
    expect(normalizeClub('  Red   CLUB ')).toBe('red club')
    expect(normalizeClub(undefined)).toBe('')
  })

  it('alerts once for a player followed directly and through a club', () => {
    const out = decide(queue(), [device('a', [player('1'), club('Red Club')])], { clubs })
    const first = out.filter((a) => a.match.team1[0].playerId === '1')
    expect(first).toHaveLength(1)
    expect(first[0].players.map((p) => p.playerId)).toEqual(['1'])
    expect(first[0].clubs).toEqual(['Red Club'])
  })

  it('alerts once for one partner followed and the other partner\'s club followed', () => {
    const groups = day(DONE, m(['7', '3'], ['2', '8']))
    const out = decide(groups, [device('a', [player('7'), club('Red Club')])], { clubs })
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['3', '7'])
  })

  it('names both sides when two followed clubs meet', () => {
    const out = decide(day(DONE, m(['3'], ['4'])), [device('a', [club('Red Club'), club('Blue Club')])], { clubs })
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['3', '4'])
    expect(out[0].clubs.slice().sort()).toEqual(['Blue Club', 'Red Club'])
  })

  it('does nothing for a player with no club, or when the club map is missing', () => {
    expect(decide(queue(), [device('a', [club('Red Club')])], { clubs: {} })).toEqual([])
    expect(decide(queue(), [device('a', [club('Red Club')])])).toEqual([])
  })

  it('never treats an empty club name as a club', () => {
    expect(decide(queue(), [device('a', [club('  ')])], { clubs: { '1': '' } })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/push-alerts.test.ts`
Expected: FAIL — cannot find module `@/lib/push/alerts`.

- [ ] **Step 3: Implement**

Create `lib/push/alerts.ts`:

```ts
import { createHash } from 'crypto'
import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from '@/lib/types'
import { computePlayingOrder } from '@/lib/playingOrder'
import { matchTag } from './text'
import type { DueAlert, PushSubscriptionRecord, Stage } from './types'

/** Club names are compared trimmed, with runs of spaces collapsed and case
 *  folded. Two clubs BAT spells differently stay two clubs. */
export function normalizeClub(name: string | undefined | null): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A short stand-in for a push address, so the sent log does not hold it. */
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
}

export function sentKeyFor(endpoint: string, tournamentId: string, dateIso: string, match: MatchEntry, stage: Stage): string {
  return `${endpointHash(endpoint)}|${tournamentId.toUpperCase()}|${dateIso}|${matchTag(match)}|${stage}`
}

// "About three away" is a small range, so a once-a-minute check cannot step over it.
const SOON_FROM = 2
const SOON_TO = 4

/** The alerts due now: for each device, each followed match at the front of
 *  the queue (`next`) or two to four places from it (`soon`) that has not been
 *  sent yet. One match is one alert per stage however the device follows it. */
export function dueAlerts(input: {
  tournamentId: string
  dateIso: string
  groups: MatchScheduleGroup[]
  records: PushSubscriptionRecord[]
  clubOf: (playerId: string) => string | undefined
  alreadySent: (key: string) => boolean
}): DueAlert[] {
  const { groups, records, clubOf, alreadySent, dateIso } = input
  const tid = input.tournamentId.toUpperCase()

  const watching = records
    .map((r) => {
      const here = r.follows.filter((f) => f.tournamentId.toUpperCase() === tid)
      const players = new Set(here.flatMap((f) => (f.kind === 'player' ? [f.playerId] : [])))
      const clubs = new Map<string, string>()
      for (const f of here) {
        if (f.kind !== 'club') continue
        const key = normalizeClub(f.clubName)
        if (key) clubs.set(key, f.clubName)
      }
      return { record: r, players, clubs }
    })
    .filter((w) => w.players.size > 0 || w.clubs.size > 0)
  if (watching.length === 0) return []

  const order = computePlayingOrder({ groups, liveByCourt: null })
  const out: DueAlert[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const position = order.get(`${gi}-${mi}`)
      if (position === undefined) continue
      const match = matches[mi]
      if (match.winner !== null || match.walkover || match.nowPlaying) continue
      const stage: Stage | null = position === 1 ? 'next' : position >= SOON_FROM && position <= SOON_TO ? 'soon' : null
      if (!stage) continue

      const inMatch: MatchPlayer[] = [...match.team1, ...match.team2]
      for (const w of watching) {
        const players: MatchPlayer[] = []
        const clubs = new Set<string>()
        for (const p of inMatch) {
          const viaClub = w.clubs.get(normalizeClub(clubOf(p.playerId)))
          if (viaClub) clubs.add(viaClub)
          if (viaClub || (p.playerId && w.players.has(p.playerId))) players.push(p)
        }
        if (players.length === 0) continue

        const endpoint = w.record.endpoint
        const sentKey = sentKeyFor(endpoint, tid, dateIso, match, stage)
        if (alreadySent(sentKey)) continue
        // "next" settles "soon" as well: an early alert must never follow the late one.
        const covers = stage === 'next' ? [sentKey, sentKeyFor(endpoint, tid, dateIso, match, 'soon')] : [sentKey]
        out.push({ endpoint, lang: w.record.lang, stage, position, sentKey, covers, match, players, clubs: Array.from(clubs) })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/push-alerts.test.ts`
Expected: PASS, 23 tests.

If "is 'soon' at two, three and four places" reports different positions, print `computePlayingOrder({ groups: queue(), liveByCourt: null })` and read its anchor rule in `lib/playingOrder.ts`: the queue must start after the last finished match. Fix the test's `queue()` to match the real rule; do not change `computePlayingOrder`.

- [ ] **Step 5: Commit**

```bash
git add lib/push/alerts.ts __tests__/push-alerts.test.ts
git commit -m "feat(alerts): decide which match alerts are due"
```

---

### Task 3: Subscription store and sent log

**Files:**
- Create: `lib/push/store.ts`, `lib/push/sent-log.ts`
- Test: `__tests__/push-store.test.ts`, `__tests__/push-sent-log.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `normalizeClub` from Task 2.
- Produces:
  ```ts
  // lib/push/store.ts
  export const MAX_PLAYER_FOLLOWS = 50
  export const MAX_CLUB_FOLLOWS = 10
  export const MAX_DEVICES = 5000
  export const STALE_DAYS = 60
  export type FollowResult = { ok: true; follows: PushFollow[] } | { ok: false; reason: 'player-limit' | 'club-limit' | 'device-limit' }
  export function __setPushRootForTesting(dir: string): void
  export async function listRecords(): Promise<PushSubscriptionRecord[]>
  export async function getRecord(endpoint: string): Promise<PushSubscriptionRecord | null>
  export async function addFollow(sub: { endpoint: string; keys: PushKeys }, lang: Lang, target: FollowTarget, now: number): Promise<FollowResult>
  export async function removeFollow(endpoint: string, target: FollowTarget): Promise<PushFollow[]>
  export async function touchRecord(endpoint: string, now: number): Promise<PushFollow[] | null>
  export async function removeRecord(endpoint: string): Promise<void>
  export async function pruneStale(now: number): Promise<number>
  // lib/push/sent-log.ts
  export function __setSentRootForTesting(dir: string): void
  export async function loadSentLog(): Promise<void>
  export function hasSent(key: string): boolean
  export async function markSent(keys: string[], dateIso: string): Promise<void>
  export async function pruneSent(todayIso: string): Promise<number>
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/push-store.test.ts`:

```ts
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  addFollow, removeFollow, getRecord, listRecords, touchRecord, removeRecord, pruneStale,
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
    expect(await touchRecord(sub('a').endpoint, T0 + DAY)).toHaveLength(1)
    expect((await getRecord(sub('a').endpoint))!.lastSeenAt).toBe(new Date(T0 + DAY).toISOString())
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
```

Create `__tests__/push-sent-log.test.ts`:

```ts
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import { hasSent, markSent, pruneSent, loadSentLog, __setSentRootForTesting } from '@/lib/push/sent-log'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'push-sent-'))
  __setSentRootForTesting(tmp)
  await loadSentLog()
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('sent log', () => {
  it('remembers what was marked', async () => {
    expect(hasSent('a')).toBe(false)
    await markSent(['a', 'b'], '2026-10-09')
    expect(hasSent('a')).toBe(true)
    expect(hasSent('b')).toBe(true)
    expect(hasSent('c')).toBe(false)
  })

  it('is read back after a restart', async () => {
    await markSent(['a'], '2026-10-09')
    __setSentRootForTesting(tmp)
    expect(hasSent('a')).toBe(false) // not loaded yet
    await loadSentLog()
    expect(hasSent('a')).toBe(true)
  })

  it('drops days older than yesterday', async () => {
    await markSent(['old'], '2026-10-07')
    await markSent(['yesterday'], '2026-10-08')
    await markSent(['today'], '2026-10-09')
    expect(await pruneSent('2026-10-09')).toBe(1)
    expect(hasSent('old')).toBe(false)
    expect(hasSent('yesterday')).toBe(true)
    expect(hasSent('today')).toBe(true)
  })

  it('starts empty from a corrupt file', async () => {
    await fs.writeFile(path.join(tmp, 'sent.json'), '{nope', 'utf8')
    __setSentRootForTesting(tmp)
    await loadSentLog()
    expect(hasSent('a')).toBe(false)
    await markSent(['a'], '2026-10-09')
    expect(hasSent('a')).toBe(true)
  })

  it('marking nothing writes nothing', async () => {
    await markSent([], '2026-10-09')
    await expect(fs.stat(path.join(tmp, 'sent.json'))).rejects.toBeDefined()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest __tests__/push-store.test.ts __tests__/push-sent-log.test.ts`
Expected: FAIL — cannot find modules `@/lib/push/store` and `@/lib/push/sent-log`.

- [ ] **Step 3: Implement the store**

Create `lib/push/store.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { Lang } from '@/lib/i18n'
import { normalizeClub } from './alerts'
import type { FollowTarget, PushFollow, PushKeys, PushSubscriptionRecord } from './types'

// The devices that asked for match alerts and what each one follows. One JSON
// file, held in memory while it is unchanged on disk, rewritten whole on every
// change through a single chain so writes within a worker never interleave. Bounded: MAX_DEVICES records of at
// most MAX_PLAYER_FOLLOWS + MAX_CLUB_FOLLOWS follows each.

export const MAX_PLAYER_FOLLOWS = 50
export const MAX_CLUB_FOLLOWS = 10
export const MAX_DEVICES = 5000
export const STALE_DAYS = 60

export type FollowResult =
  | { ok: true; follows: PushFollow[] }
  | { ok: false; reason: 'player-limit' | 'club-limit' | 'device-limit' }

let root = path.join(process.cwd(), '.cache', 'push')
let records: Map<string, PushSubscriptionRecord> | null = null
/** The file's modified time when it was last read or written here. Another
 *  worker's write changes it, and the next use reads the file again. */
let readMtimeMs: number | null = null
let chain: Promise<unknown> = Promise.resolve()

export function __setPushRootForTesting(dir: string): void {
  root = dir
  records = null
  readMtimeMs = null
  chain = Promise.resolve()
}

const file = () => path.join(root, 'subscriptions.json')

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
  if (records && mtime === readMtimeMs) return records
  readMtimeMs = mtime
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
  records = map
  return map
}

async function save(map: Map<string, PushSubscriptionRecord>): Promise<void> {
  const tmp = `${file()}.tmp.${process.pid}`
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(tmp, JSON.stringify({ version: 1, records: Array.from(map.values()) }), 'utf8')
  await fs.rename(tmp, file())
  readMtimeMs = await mtimeOf()
}

/** Runs one change at a time over the loaded map, and writes it when asked. */
function change<T>(fn: (map: Map<string, PushSubscriptionRecord>) => { value: T; dirty: boolean }): Promise<T> {
  const run = chain.then(async () => {
    const map = await load()
    const { value, dirty } = fn(map)
    if (dirty) await save(map)
    return value
  })
  chain = run.catch(() => undefined)
  return run
}

function sameTarget(f: PushFollow, t: FollowTarget): boolean {
  if (f.kind !== t.kind || f.tournamentId !== t.tournamentId.toUpperCase()) return false
  if (f.kind === 'player' && t.kind === 'player') return f.playerId === t.playerId
  if (f.kind === 'club' && t.kind === 'club') return normalizeClub(f.clubName) === normalizeClub(t.clubName)
  return false
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
): Promise<FollowResult> {
  return change<FollowResult>((map) => {
    const at = new Date(now).toISOString()
    const existing = map.get(sub.endpoint)
    if (!existing && map.size >= MAX_DEVICES) return { value: { ok: false, reason: 'device-limit' }, dirty: false }
    const rec: PushSubscriptionRecord = existing ?? { endpoint: sub.endpoint, keys: sub.keys, lang, follows: [], createdAt: at, lastSeenAt: at }

    if (!rec.follows.some((f) => sameTarget(f, target))) {
      const count = rec.follows.filter((f) => f.kind === target.kind).length
      if (target.kind === 'player' && count >= MAX_PLAYER_FOLLOWS) return { value: { ok: false, reason: 'player-limit' }, dirty: false }
      if (target.kind === 'club' && count >= MAX_CLUB_FOLLOWS) return { value: { ok: false, reason: 'club-limit' }, dirty: false }
      const tournamentId = target.tournamentId.toUpperCase()
      rec.follows.push(
        target.kind === 'player'
          ? { kind: 'player', tournamentId, playerId: target.playerId, playerName: target.playerName ?? '', addedAt: at }
          : { kind: 'club', tournamentId, clubName: target.clubName.replace(/\s+/g, ' ').trim(), addedAt: at },
      )
    }
    rec.keys = sub.keys
    rec.lang = lang
    rec.lastSeenAt = at
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
    if (kept.length === 0) map.delete(endpoint)
    else rec.follows = kept
    return { value: kept, dirty: true }
  })
}

export async function touchRecord(endpoint: string, now: number): Promise<PushFollow[] | null> {
  return change((map) => {
    const rec = map.get(endpoint)
    if (!rec) return { value: null, dirty: false }
    rec.lastSeenAt = new Date(now).toISOString()
    return { value: rec.follows.slice(), dirty: true }
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
```

- [ ] **Step 4: Implement the sent log**

Create `lib/push/sent-log.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'

// Which alerts have gone out, so each is sent once: sent key → the day it
// belongs to. Loaded once, rewritten whole after each batch. A day's keys are
// dropped two days later, which bounds it to two days of alerts.

let root = path.join(process.cwd(), '.cache', 'push')
let sent = new Map<string, string>()
let chain: Promise<unknown> = Promise.resolve()

export function __setSentRootForTesting(dir: string): void {
  root = dir
  sent = new Map()
  chain = Promise.resolve()
}

const file = () => path.join(root, 'sent.json')

export async function loadSentLog(): Promise<void> {
  const map = new Map<string, string>()
  try {
    const parsed = JSON.parse(await fs.readFile(file(), 'utf8')) as { sent?: Record<string, unknown> }
    for (const [key, day] of Object.entries(parsed.sent ?? {})) {
      if (typeof day === 'string') map.set(key, day)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[push] sent log unreadable, starting empty:', err instanceof Error ? err.message : err)
    }
  }
  sent = map
}

export function hasSent(key: string): boolean {
  return sent.has(key)
}

function save(): Promise<void> {
  const run = chain.then(async () => {
    const tmp = `${file()}.tmp.${process.pid}`
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, sent: Object.fromEntries(sent) }), 'utf8')
    await fs.rename(tmp, file())
  })
  chain = run.catch(() => undefined)
  return run
}

export async function markSent(keys: string[], dateIso: string): Promise<void> {
  if (keys.length === 0) return
  for (const key of keys) sent.set(key, dateIso)
  await save()
}

/** Drops keys for days before yesterday. Returns how many went. */
export async function pruneSent(todayIso: string): Promise<number> {
  const yesterday = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  let removed = 0
  for (const [key, day] of Array.from(sent)) {
    if (day < yesterday) { sent.delete(key); removed++ }
  }
  if (removed > 0) await save()
  return removed
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/push-store.test.ts __tests__/push-sent-log.test.ts`
Expected: PASS, 15 + 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/push/store.ts lib/push/sent-log.ts __tests__/push-store.test.ts __tests__/push-sent-log.test.ts
git commit -m "feat(alerts): store push subscriptions, follows and what was sent"
```

---

### Task 4: Settings, validation, club lookup and the sender

**Files:**
- Create: `lib/push/config.ts`, `lib/push/validate.ts`, `lib/push/clubs.ts`, `lib/push/sender.ts`
- Modify: `package.json` (dependency), `next.config.js` (external package), `.env.example`
- Test: `__tests__/push-validate.test.ts`, `__tests__/push-clubs.test.ts`, `__tests__/push-sender.test.ts`

**Interfaces:**
- Consumes: `playerClubCache` from `@/lib/bracket-cache`; `readClubsCache` from `@/lib/clubs-cache`; `normalizeClub` (Task 2); types (Task 1).
- Produces:
  ```ts
  // config.ts
  export interface PushConfig { publicKey: string; privateKey: string; subject: string }
  export function pushConfig(env?: NodeJS.ProcessEnv): PushConfig | null
  // validate.ts
  export function isPushEndpoint(value: unknown): value is string
  export function isGuid(value: unknown): value is string
  export function parseSubscription(value: unknown): { endpoint: string; keys: PushKeys } | null
  export function parseTarget(value: unknown, forFollow: boolean): FollowTarget | null
  // clubs.ts
  export interface ClubLookup { clubOf: (playerId: string) => string | undefined; hasClub: (name: string) => boolean }
  export async function clubLookup(tournamentId: string): Promise<ClubLookup>
  // sender.ts
  export type SendResult = 'ok' | 'gone' | 'failed'
  export type Sender = (record: Pick<PushSubscriptionRecord, 'endpoint' | 'keys'>, payload: PushPayload) => Promise<SendResult>
  export function webPushSender(config: PushConfig, send?: typeof import('web-push').sendNotification): Sender
  ```

- [ ] **Step 1: Add the dependency**

```bash
npm install web-push@^3.6.7
npm install -D @types/web-push@^3.6.4
```

In `next.config.js`, change the external packages line to:

```js
    serverComponentsExternalPackages: ['playwright-core', '@sparticuz/chromium', 'web-push'],
```

Append to `.env.example`:

```
# Match alerts (web push). Generate a key pair once with:
#   npx web-push generate-vapid-keys
# and set all three in .env.production on the server. With any of them unset
# the feature is off: no follow button, and nothing is sent.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
# A contact address the push services can reach, as a mailto: link.
VAPID_SUBJECT=
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/push-validate.test.ts`:

```ts
import { isPushEndpoint, isGuid, parseSubscription, parseTarget } from '@/lib/push/validate'
import { pushConfig } from '@/lib/push/config'

const TID = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('isPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGk',
    'https://api.push.apple.com/3/device/x',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-sg2p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (url) => { expect(isPushEndpoint(url)).toBe(true) })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/fcm/send/abc',
    'https://evil.example/fcm.googleapis.com',
    'https://push.apple.com.evil.example/x',
    'https://127.0.0.1/x',
    'https://localhost:3000/api/bmstats',
    'not a url',
    '',
    5,
    null,
  ])('rejects %p', (url) => { expect(isPushEndpoint(url)).toBe(false) })

  it('rejects an address longer than 1000 characters', () => {
    expect(isPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(1000)}`)).toBe(false)
  })
})

describe('parseSubscription', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk', auth: 'q1' } }
  it('keeps the endpoint and the two keys, nothing else', () => {
    expect(parseSubscription({ ...good, expirationTime: null, extra: 1 })).toEqual(good)
  })
  it.each([
    null, 'x', {}, { endpoint: 'https://evil.example/x', keys: good.keys },
    { endpoint: good.endpoint }, { endpoint: good.endpoint, keys: { p256dh: 'x' } },
    { endpoint: good.endpoint, keys: { p256dh: 5, auth: 'x' } },
    { endpoint: good.endpoint, keys: { p256dh: 'x'.repeat(300), auth: 'x' } },
  ])('rejects %p', (v) => { expect(parseSubscription(v)).toBeNull() })
})

describe('parseTarget', () => {
  it('reads a player target and trims the name', () => {
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42', playerName: '  Anan Dee ' }, true))
      .toEqual({ kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42', playerName: 'Anan Dee' })
  })
  it('needs a name to follow a player, not to unfollow', () => {
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42' }, true)).toBeNull()
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42' }, false))
      .toEqual({ kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42' })
  })
  it('reads a club target', () => {
    expect(parseTarget({ kind: 'club', tournamentId: TID, clubName: ' Red  Club ' }, true))
      .toEqual({ kind: 'club', tournamentId: TID.toUpperCase(), clubName: 'Red Club' })
  })
  it.each([
    null, {}, { kind: 'country', tournamentId: TID },
    { kind: 'player', tournamentId: 'nope', playerId: '1', playerName: 'A' },
    { kind: 'player', tournamentId: TID, playerId: '1;x', playerName: 'A' },
    { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'A'.repeat(121) },
    { kind: 'club', tournamentId: TID, clubName: '   ' },
    { kind: 'club', tournamentId: TID, clubName: 'C'.repeat(121) },
  ])('rejects %p', (v) => { expect(parseTarget(v, true)).toBeNull() })
  it('knows a GUID', () => {
    expect(isGuid(TID)).toBe(true)
    expect(isGuid(TID.toUpperCase())).toBe(true)
    expect(isGuid('abc')).toBe(false)
  })
})

describe('pushConfig', () => {
  const full = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' }
  it('is the three settings when all are there', () => {
    expect(pushConfig(full as never)).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' })
  })
  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])('is off without %s', (k) => {
    expect(pushConfig({ ...full, [k]: '' } as never)).toBeNull()
    expect(pushConfig({ ...full, [k]: '   ' } as never)).toBeNull()
  })
  it('is off when the subject is not a mailto: or https: address', () => {
    expect(pushConfig({ ...full, VAPID_SUBJECT: 'someone' } as never)).toBeNull()
  })
})
```

Create `__tests__/push-clubs.test.ts`:

```ts
jest.mock('../lib/bracket-cache', () => ({ playerClubCache: new Map<string, string>() }))
jest.mock('../lib/clubs-cache', () => ({ readClubsCache: jest.fn() }))

import { clubLookup } from '@/lib/push/clubs'
import { playerClubCache } from '@/lib/bracket-cache'
import { readClubsCache } from '@/lib/clubs-cache'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const disk = readClubsCache as jest.Mock
const mem = playerClubCache as Map<string, string>

beforeEach(() => { mem.clear(); disk.mockReset().mockResolvedValue(null) })

describe('clubLookup', () => {
  it('knows nobody when nothing is held', async () => {
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBeUndefined()
    expect(c.hasClub('Red Club')).toBe(false)
  })

  it('reads the disk copy', async () => {
    disk.mockResolvedValue({ '1': 'Red Club' })
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBe('Red Club')
    expect(c.hasClub(' red  CLUB')).toBe(true)
    expect(c.hasClub('Blue Club')).toBe(false)
  })

  it('prefers the in-memory copy, which is fresher, and finds its clubs too', async () => {
    disk.mockResolvedValue({ '1': 'Old Club' })
    mem.set(`${TID.toLowerCase()}:1`, 'New Club')
    mem.set(`${TID.toLowerCase()}:2`, 'Blue Club')
    mem.set('bbbbbbbb-0000-0000-0000-000000000002:3', 'Other Tournament Club')
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBe('New Club')
    expect(c.clubOf('2')).toBe('Blue Club')
    expect(c.hasClub('blue club')).toBe(true)
    expect(c.hasClub('Other Tournament Club')).toBe(false)
  })

  it('still answers when the disk read fails', async () => {
    disk.mockRejectedValue(new Error('EIO'))
    mem.set(`${TID.toLowerCase()}:1`, 'Red Club')
    expect((await clubLookup(TID)).clubOf('1')).toBe('Red Club')
  })
})
```

Create `__tests__/push-sender.test.ts`:

```ts
import { webPushSender } from '@/lib/push/sender'

const config = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' }
const record = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }
const payload = { title: 'Up next', body: 'A vs B', url: '/?tournament=T', tag: 't' }

describe('webPushSender', () => {
  it('sends the payload as JSON, high urgency, ten-minute lifetime, signed with the keys', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 201 })
    expect(await webPushSender(config, send as never)(record, payload)).toBe('ok')
    const [sub, body, options] = send.mock.calls[0]
    expect(sub).toEqual(record)
    expect(JSON.parse(body)).toEqual(payload)
    expect(options).toEqual({ TTL: 600, urgency: 'high', vapidDetails: config })
  })

  it.each([404, 410])('reports a device the push service no longer knows (%i)', async (statusCode) => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode }))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('gone')
  })

  it.each([400, 413, 429, 500])('reports any other answer as a failure (%i)', async (statusCode) => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('no'), { statusCode }))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('failed')
  })

  it('reports a network error as a failure, and never throws', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ECONNRESET'))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('failed')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest __tests__/push-validate.test.ts __tests__/push-clubs.test.ts __tests__/push-sender.test.ts`
Expected: FAIL — the four modules do not exist.

- [ ] **Step 4: Implement**

Create `lib/push/config.ts`:

```ts
export interface PushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

/** The push settings, or null when any is missing: the feature is then off. */
export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim()
  const subject = (env.VAPID_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null
  return { publicKey, privateKey, subject }
}
```

Create `lib/push/validate.ts`:

```ts
import type { FollowTarget, PushKeys } from './types'

// The server sends a request to whatever address a subscription names, so
// only the push services browsers actually use are accepted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
  } catch {
    return false
  }
}

export function isGuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

export function parseSubscription(value: unknown): { endpoint: string; keys: PushKeys } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (!isPushEndpoint(v.endpoint) || !v.keys) return null
  if (!short(v.keys.p256dh, 200) || !short(v.keys.auth, 200)) return null
  return { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** A follow or unfollow target, with the tournament id upper-cased and names
 *  tidied. Following a player needs the name to show in the list. */
export function parseTarget(value: unknown, forFollow: boolean): FollowTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!isGuid(v.tournamentId)) return null
  const tournamentId = v.tournamentId.toUpperCase()
  if (v.kind === 'player') {
    if (typeof v.playerId !== 'string' || !/^\d{1,12}$/.test(v.playerId)) return null
    if (typeof v.playerName === 'string' && v.playerName.length <= 120 && tidy(v.playerName)) {
      return { kind: 'player', tournamentId, playerId: v.playerId, playerName: tidy(v.playerName) }
    }
    if (v.playerName !== undefined || forFollow) return null
    return { kind: 'player', tournamentId, playerId: v.playerId }
  }
  if (v.kind === 'club') {
    if (typeof v.clubName !== 'string' || v.clubName.length > 120 || !tidy(v.clubName)) return null
    return { kind: 'club', tournamentId, clubName: tidy(v.clubName) }
  }
  return null
}
```

Create `lib/push/clubs.ts`:

```ts
import { playerClubCache } from '@/lib/bracket-cache'
import { readClubsCache } from '@/lib/clubs-cache'
import { normalizeClub } from './alerts'

export interface ClubLookup {
  /** The club BAT lists a player under in this tournament, when known. */
  clubOf: (playerId: string) => string | undefined
  /** Whether any player in this tournament is listed under this club. */
  hasClub: (name: string) => boolean
}

/** Club membership for one tournament, from what the app already holds: the
 *  in-memory map the bracket and roster walks fill (fresher), over the copy
 *  the index rebuild writes to disk. Never asks BAT. */
export async function clubLookup(tournamentId: string): Promise<ClubLookup> {
  const prefix = `${tournamentId.toLowerCase()}:`
  const disk = (await readClubsCache(tournamentId).catch(() => null)) ?? {}
  const clubOf = (playerId: string) => playerClubCache.get(`${prefix}${playerId}`) ?? disk[playerId]
  const hasClub = (name: string) => {
    const want = normalizeClub(name)
    if (!want) return false
    for (const club of Object.values(disk)) if (normalizeClub(club) === want) return true
    for (const [key, club] of Array.from(playerClubCache)) {
      if (key.startsWith(prefix) && normalizeClub(club) === want) return true
    }
    return false
  }
  return { clubOf, hasClub }
}
```

Create `lib/push/sender.ts`:

```ts
import webpush from 'web-push'
import type { PushConfig } from './config'
import type { PushPayload, PushSubscriptionRecord } from './types'

export type SendResult = 'ok' | 'gone' | 'failed'

/** Delivers one notification to one device. A second channel would be
 *  another function of this shape. */
export type Sender = (record: Pick<PushSubscriptionRecord, 'endpoint' | 'keys'>, payload: PushPayload) => Promise<SendResult>

// An alert that cannot be delivered within ten minutes is no longer useful.
const TTL_SECONDS = 600

export function webPushSender(config: PushConfig, send: typeof webpush.sendNotification = webpush.sendNotification): Sender {
  return async (record, payload) => {
    try {
      await send(
        { endpoint: record.endpoint, keys: record.keys },
        JSON.stringify(payload),
        { TTL: TTL_SECONDS, urgency: 'high', vapidDetails: config },
      )
      return 'ok'
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      // The push service no longer knows this device: it unsubscribed or was reset.
      if (status === 404 || status === 410) return 'gone'
      console.warn(`[push] send failed status=${status ?? 'none'}:`, err instanceof Error ? err.message : err)
      return 'failed'
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/push-validate.test.ts __tests__/push-clubs.test.ts __tests__/push-sender.test.ts && npx tsc --noEmit`
Expected: PASS; no new type errors.

If `tsc` rejects `{ TTL, urgency, vapidDetails }`, open `node_modules/@types/web-push/index.d.ts`, read `RequestOptions`, and use the field names it declares. `vapidDetails` there is `{ subject, publicKey, privateKey }`, the same shape as `PushConfig`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.js .env.example lib/push/config.ts lib/push/validate.ts lib/push/clubs.ts lib/push/sender.ts __tests__/push-validate.test.ts __tests__/push-clubs.test.ts __tests__/push-sender.test.ts
git commit -m "feat(alerts): push settings, input checks, club lookup and the sender"
```

---

### Task 5: API routes

**Files:**
- Create: `app/api/push/key/route.ts`, `app/api/push/follow/route.ts`, `app/api/push/unfollow/route.ts`, `app/api/push/state/route.ts`
- Test: `__tests__/api-push-routes.test.ts`

**Interfaces:**
- Consumes: `pushConfig` , `parseSubscription`, `parseTarget`, `isPushEndpoint`, `clubLookup` (Task 4); `addFollow`, `removeFollow`, `touchRecord` (Task 3); `listAllTournaments` from `@/lib/tournaments-registry` (entries have `id`, `provider`, `done`).
- Produces:
  - `GET /api/push/key` → `200 { publicKey }` | `404`
  - `POST /api/push/follow` `{ subscription, lang, target }` → `200 { follows }` | `400` | `404` (feature off) | `429 { error, reason }`
  - `POST /api/push/unfollow` `{ endpoint, target }` → `200 { follows }` | `400` | `404`
  - `POST /api/push/state` `{ endpoint }` → `200 { follows }` (empty for a stranger) | `400` | `404`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-push-routes.test.ts`:

```ts
jest.mock('../lib/push/config', () => ({ pushConfig: jest.fn() }))
jest.mock('../lib/push/store', () => ({ addFollow: jest.fn(), removeFollow: jest.fn(), touchRecord: jest.fn() }))
jest.mock('../lib/push/clubs', () => ({ clubLookup: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({ listAllTournaments: jest.fn() }))

import { GET as getKey } from '@/app/api/push/key/route'
import { POST as follow } from '@/app/api/push/follow/route'
import { POST as unfollow } from '@/app/api/push/unfollow/route'
import { POST as state } from '@/app/api/push/state/route'
import { pushConfig } from '@/lib/push/config'
import { addFollow, removeFollow, touchRecord } from '@/lib/push/store'
import { clubLookup } from '@/lib/push/clubs'
import { listAllTournaments } from '@/lib/tournaments-registry'

const TID = 'aaaaaaaa-0000-0000-0000-000000000001'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const SUB = { endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }
const PLAYER = { kind: 'player', tournamentId: TID, playerId: '42', playerName: 'Anan Dee' }
const CLUB = { kind: 'club', tournamentId: TID, clubName: 'Red Club' }

const config = pushConfig as jest.Mock
const add = addFollow as jest.Mock
const remove = removeFollow as jest.Mock
const touch = touchRecord as jest.Mock
const clubs = clubLookup as jest.Mock
const registry = listAllTournaments as jest.Mock

const post = (body: unknown) => new Request('http://x/api/push', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
  config.mockReset().mockReturnValue({ publicKey: 'PUB', privateKey: 'priv', subject: 'mailto:a@b.c' })
  add.mockReset().mockResolvedValue({ ok: true, follows: [{ kind: 'player' }] })
  remove.mockReset().mockResolvedValue([])
  touch.mockReset().mockResolvedValue([{ kind: 'player' }])
  clubs.mockReset().mockResolvedValue({ clubOf: () => undefined, hasClub: (n: string) => n === 'Red Club' })
  registry.mockReset().mockReturnValue([{ id: TID.toUpperCase(), provider: 'bat', done: false }])
})

describe('GET /api/push/key', () => {
  it('gives the public key, and never the private one', async () => {
    const res = await getKey()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publicKey: 'PUB' })
  })
  it('is 404 when the feature is off', async () => {
    config.mockReturnValue(null)
    expect((await getKey()).status).toBe(404)
  })
})

describe('POST /api/push/follow', () => {
  it('follows a player', async () => {
    const res = await follow(post({ subscription: SUB, lang: 'th', target: PLAYER }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [{ kind: 'player' }] })
    const [sub, lang, target] = add.mock.calls[0]
    expect(sub).toEqual(SUB)
    expect(lang).toBe('th')
    expect(target).toEqual({ ...PLAYER, tournamentId: TID.toUpperCase() })
  })

  it('defaults an unknown language to English', async () => {
    await follow(post({ subscription: SUB, lang: 'xx', target: PLAYER }))
    expect(add.mock.calls[0][1]).toBe('en')
  })

  it('follows a club that exists in the tournament', async () => {
    expect((await follow(post({ subscription: SUB, lang: 'en', target: CLUB }))).status).toBe(200)
    expect(clubs).toHaveBeenCalledWith(TID.toUpperCase())
  })

  it('refuses a club the tournament does not have', async () => {
    const res = await follow(post({ subscription: SUB, lang: 'en', target: { ...CLUB, clubName: 'Made Up' } }))
    expect(res.status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{nope'],
    ['no subscription', { lang: 'en', target: PLAYER }],
    ['an endpoint off the push services', { subscription: { ...SUB, endpoint: 'https://evil.example/x' }, lang: 'en', target: PLAYER }],
    ['no target', { subscription: SUB, lang: 'en' }],
    ['a bad player id', { subscription: SUB, lang: 'en', target: { ...PLAYER, playerId: '1;x' } }],
  ])('is 400 for %s', async (_name, body) => {
    expect((await follow(post(body))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it('is 400 for a BWF tournament', async () => {
    registry.mockReturnValue([{ id: TID.toUpperCase(), provider: 'bwf', done: false }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
  })

  it('is 400 for a tournament the site does not list, so nobody can make the watcher poll a made-up id', async () => {
    registry.mockReturnValue([{ id: 'BBBBBBBB-0000-0000-0000-000000000002', provider: 'bat', done: false }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(400)
    expect((await follow(post({ subscription: SUB, lang: 'en', target: CLUB }))).status).toBe(400)
    expect(add).not.toHaveBeenCalled()
    expect(clubs).not.toHaveBeenCalled()
  })

  it('still lets a finished tournament be followed (nothing is sent for it, and it can be unfollowed)', async () => {
    registry.mockReturnValue([{ id: TID.toUpperCase(), provider: 'bat', done: true }])
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(200)
  })

  it.each(['player-limit', 'club-limit', 'device-limit'])('is 429 at the %s', async (reason) => {
    add.mockResolvedValue({ ok: false, reason })
    const res = await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe(reason)
  })

  it('is 404 when the feature is off, and stores nothing', async () => {
    config.mockReturnValue(null)
    expect((await follow(post({ subscription: SUB, lang: 'en', target: PLAYER }))).status).toBe(404)
    expect(add).not.toHaveBeenCalled()
  })
})

describe('POST /api/push/unfollow', () => {
  it('unfollows without needing the player name', async () => {
    remove.mockResolvedValue([{ kind: 'club' }])
    const res = await unfollow(post({ endpoint: ENDPOINT, target: { kind: 'player', tournamentId: TID, playerId: '42' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [{ kind: 'club' }] })
    expect(remove).toHaveBeenCalledWith(ENDPOINT, { kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42' })
  })

  it('unfollows a club without checking it still exists', async () => {
    expect((await unfollow(post({ endpoint: ENDPOINT, target: { ...CLUB, clubName: 'Gone Club' } }))).status).toBe(200)
    expect(clubs).not.toHaveBeenCalled()
  })

  it.each([[{ target: PLAYER }], [{ endpoint: 'https://evil.example/x', target: PLAYER }], [{ endpoint: ENDPOINT }], ['{nope']])(
    'is 400 for %p', async (body) => {
      expect((await unfollow(post(body))).status).toBe(400)
      expect(remove).not.toHaveBeenCalled()
    })

  it('is 404 when the feature is off', async () => {
    config.mockReturnValue(null)
    expect((await unfollow(post({ endpoint: ENDPOINT, target: PLAYER }))).status).toBe(404)
  })
})

describe('POST /api/push/state', () => {
  it('returns the device\'s follows', async () => {
    const res = await state(post({ endpoint: ENDPOINT }))
    expect(await res.json()).toEqual({ follows: [{ kind: 'player' }] })
    expect(touch.mock.calls[0][0]).toBe(ENDPOINT)
  })
  it('is an empty list for a device the server does not know', async () => {
    touch.mockResolvedValue(null)
    const res = await state(post({ endpoint: ENDPOINT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ follows: [] })
  })
  it('is 400 for a bad endpoint and 404 when off', async () => {
    expect((await state(post({ endpoint: 'x' }))).status).toBe(400)
    config.mockReturnValue(null)
    expect((await state(post({ endpoint: ENDPOINT }))).status).toBe(404)
  })
  it('never lets a response be cached', async () => {
    expect((await state(post({ endpoint: ENDPOINT }))).headers.get('Cache-Control')).toBe('no-store')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/api-push-routes.test.ts`
Expected: FAIL — the route modules do not exist.

- [ ] **Step 3: Implement the routes**

Create `app/api/push/key/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'

export const dynamic = 'force-dynamic'

// The public half of the push key pair: a browser needs it to subscribe. 404
// tells the page the feature is off.
export async function GET() {
  const config = pushConfig()
  if (!config) return NextResponse.json({ error: 'match alerts are not set up' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ publicKey: config.publicKey }, { headers: { 'Cache-Control': 'no-store' } })
}
```

Create `app/api/push/follow/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { parseSubscription, parseTarget } from '@/lib/push/validate'
import { clubLookup } from '@/lib/push/clubs'
import { addFollow } from '@/lib/push/store'
import { listAllTournaments } from '@/lib/tournaments-registry'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// Follow a player or a club in one tournament from one device. The device is
// its push subscription; nothing else identifies it.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; lang?: unknown; target?: unknown } | null
  const subscription = parseSubscription(body?.subscription)
  const target = parseTarget(body?.target, true)
  if (!subscription || !target) return answer({ error: 'subscription and target required' }, 400)
  // Only a BAT tournament the site lists. resolveRef would not do: it treats
  // any unknown id as BAT, and the watcher asks for the schedule of every
  // followed tournament, so a made-up id must never get this far.
  const listed = listAllTournaments().some((t) => t.id.toUpperCase() === target.tournamentId && t.provider === 'bat')
  if (!listed) return answer({ error: 'match alerts are for BAT tournaments listed on this site' }, 400)
  // A club follow can only name a club that tournament has.
  if (target.kind === 'club' && !(await clubLookup(target.tournamentId)).hasClub(target.clubName)) {
    return answer({ error: 'no such club in this tournament' }, 400)
  }
  const lang = body?.lang === 'th' ? 'th' : 'en'
  const result = await addFollow(subscription, lang, target, Date.now())
  if (!result.ok) return answer({ error: 'follow limit reached', reason: result.reason }, 429)
  return answer({ follows: result.follows })
}
```

Create `app/api/push/unfollow/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { isPushEndpoint, parseTarget } from '@/lib/push/validate'
import { removeFollow } from '@/lib/push/store'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown; target?: unknown } | null
  const target = parseTarget(body?.target, false)
  if (!isPushEndpoint(body?.endpoint) || !target) return answer({ error: 'endpoint and target required' }, 400)
  return answer({ follows: await removeFollow(body.endpoint, target) })
}
```

Create `app/api/push/state/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'
import { isPushEndpoint } from '@/lib/push/validate'
import { touchRecord } from '@/lib/push/store'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const answer = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

// What this device follows. Asking also marks the device as seen, which is
// what keeps it from being pruned as stale.
export async function POST(request: Request) {
  if (!pushConfig()) return answer({ error: 'match alerts are not set up' }, 404)
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
  if (!isPushEndpoint(body?.endpoint)) return answer({ error: 'endpoint required' }, 400)
  return answer({ follows: (await touchRecord(body.endpoint, Date.now())) ?? [] })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api-push-routes.test.ts && npx tsc --noEmit`
Expected: PASS; no new type errors. `parseTarget(…, false)` accepts a target that carries `playerName`, so the first unfollow `it.each` row with `target: PLAYER` is valid and that row must fail only for the missing endpoint — which it does.

- [ ] **Step 5: Commit**

```bash
git add app/api/push __tests__/api-push-routes.test.ts
git commit -m "feat(alerts): API to follow, unfollow and read back follows"
```

---

### Task 6: The watcher

**Files:**
- Create: `lib/push/stats.ts`, `lib/push/watcher.ts`
- Modify: `instrumentation.ts` (start it), `app/api/bmstats/route.ts`, `components/BmStats.tsx`
- Test: `__tests__/push-watcher.test.ts`

**Interfaces:**
- Consumes: `dueAlerts` (Task 2); `alertPayload`, `digestPayload` (Task 1); store and sent log (Task 3); `clubLookup`, `Sender`, `webPushSender`, `pushConfig` (Task 4); `batDownSince`; `getTodayIso` from `@/lib/today`.
- Produces:
  ```ts
  // stats.ts
  export function recordPush(result: 'ok' | 'gone' | 'failed', dayIso: string): void
  export function getPushStats(dayIso: string): { sentToday: number; failedToday: number; goneToday: number }
  // watcher.ts
  export interface WatcherDeps {
    now: () => number
    todayIso: () => string
    isBatDown: () => boolean
    listRecords: () => Promise<PushSubscriptionRecord[]>
    isWatchable: (tournamentId: string) => boolean
    fetchDay: (tournamentId: string, dateIso: string) => Promise<MatchScheduleGroup[] | null>
    clubOf: (tournamentId: string) => Promise<(playerId: string) => string | undefined>
    hasSent: (key: string) => boolean
    markSent: (keys: string[], dateIso: string) => Promise<void>
    send: Sender
    removeRecord: (endpoint: string) => Promise<void>
    record: (result: SendResult, dayIso: string) => void
  }
  export function __resetWatcherForTesting(): void
  export async function runWatcherTick(deps: WatcherDeps): Promise<{ sent: number; failed: number; gone: number }>
  export function startPushWatcher(opts: { isLeader: () => boolean; origin: string }): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing test**

Create `__tests__/push-watcher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/push-watcher.test.ts`
Expected: FAIL — cannot find module `@/lib/push/watcher`.

- [ ] **Step 3: Implement the day's counts**

Create `lib/push/stats.ts`:

```ts
// How many alerts went out today, for the status page. In memory only: a
// restart starts the day's count again, which is all the page needs.
let day = ''
let counts = { sentToday: 0, failedToday: 0, goneToday: 0 }

function roll(dayIso: string): void {
  if (day === dayIso) return
  day = dayIso
  counts = { sentToday: 0, failedToday: 0, goneToday: 0 }
}

export function recordPush(result: 'ok' | 'gone' | 'failed', dayIso: string): void {
  roll(dayIso)
  if (result === 'ok') counts.sentToday++
  else if (result === 'gone') counts.goneToday++
  else counts.failedToday++
}

export function getPushStats(dayIso: string): { sentToday: number; failedToday: number; goneToday: number } {
  roll(dayIso)
  return { ...counts }
}
```

- [ ] **Step 4: Implement the watcher**

Create `lib/push/watcher.ts`:

```ts
import type { MatchesData, MatchScheduleGroup } from '@/lib/types'
import { dueAlerts } from './alerts'
import { alertPayload, digestPayload } from './text'
import type { Sender, SendResult } from './sender'
import type { DueAlert, PushSubscriptionRecord } from './types'

export interface WatcherDeps {
  now: () => number
  todayIso: () => string
  isBatDown: () => boolean
  listRecords: () => Promise<PushSubscriptionRecord[]>
  /** Whether a tournament is worth asking about: listed, BAT, not finished. */
  isWatchable: (tournamentId: string) => boolean
  /** Today's schedule for a tournament, or null when it has none today. */
  fetchDay: (tournamentId: string, dateIso: string) => Promise<MatchScheduleGroup[] | null>
  clubOf: (tournamentId: string) => Promise<(playerId: string) => string | undefined>
  hasSent: (key: string) => boolean
  markSent: (keys: string[], dateIso: string) => Promise<void>
  send: Sender
  removeRecord: (endpoint: string) => Promise<void>
  record: (result: SendResult, dayIso: string) => void
}

// More than this many alerts for one device in one tick go out as one notification.
const SINGLE_MAX = 2
// An alert that keeps failing is dropped after this many ticks.
const GIVE_UP_AFTER = 3

/** Failed ticks per alert, by sent key. In memory: a restart forgets them, and
 *  the alert simply gets its tries again. */
const failures = new Map<string, number>()

export function __resetWatcherForTesting(): void {
  failures.clear()
}

/** One pass: for each tournament someone follows, decide what is due on
 *  today's schedule, send it, and record what went out. */
export async function runWatcherTick(deps: WatcherDeps): Promise<{ sent: number; failed: number; gone: number }> {
  const tally = { sent: 0, failed: 0, gone: 0 }
  // A stale schedule would announce matches that are not about to start.
  if (deps.isBatDown()) return tally
  const records = await deps.listRecords()
  if (records.length === 0) return tally

  const dateIso = deps.todayIso()
  const minuteKey = new Date(deps.now()).toISOString().slice(0, 16)
  // A follow left on a finished tournament must not cost a request a minute.
  const tournaments = Array.from(new Set(records.flatMap((r) => r.follows.map((f) => f.tournamentId.toUpperCase()))))
    .filter((id) => deps.isWatchable(id))
  const goneEndpoints = new Set<string>()

  for (const tournamentId of tournaments) {
    let due: DueAlert[]
    try {
      const groups = await deps.fetchDay(tournamentId, dateIso)
      if (!groups) continue
      const clubOf = await deps.clubOf(tournamentId)
      due = dueAlerts({ tournamentId, dateIso, groups, records, clubOf, alreadySent: deps.hasSent })
    } catch (err) {
      console.warn(`[push] tick skipped ${tournamentId}:`, err instanceof Error ? err.message : err)
      continue
    }

    const byDevice = new Map<string, DueAlert[]>()
    for (const alert of due) {
      if (goneEndpoints.has(alert.endpoint)) continue
      byDevice.set(alert.endpoint, [...(byDevice.get(alert.endpoint) ?? []), alert])
    }

    for (const [endpoint, alerts] of Array.from(byDevice)) {
      const record = records.find((r) => r.endpoint === endpoint)
      if (!record) continue
      const batches = alerts.length > SINGLE_MAX
        ? [{ alerts, payload: digestPayload(alerts, tournamentId, minuteKey) }]
        : alerts.map((a) => ({ alerts: [a], payload: alertPayload(a, tournamentId) }))

      for (const batch of batches) {
        const keys = batch.alerts.flatMap((a) => a.covers)
        const result: SendResult = await deps.send(record, batch.payload).catch(() => 'failed' as const)
        deps.record(result, dateIso)
        if (result === 'ok') {
          tally.sent++
          await deps.markSent(keys, dateIso)
          batch.alerts.forEach((a) => failures.delete(a.sentKey))
        } else if (result === 'gone') {
          tally.gone++
          goneEndpoints.add(endpoint)
          await deps.removeRecord(endpoint)
          break
        } else {
          tally.failed++
          const settled: string[] = []
          for (const a of batch.alerts) {
            const tries = (failures.get(a.sentKey) ?? 0) + 1
            if (tries >= GIVE_UP_AFTER) { failures.delete(a.sentKey); settled.push(...a.covers) }
            else failures.set(a.sentKey, tries)
          }
          if (settled.length > 0) await deps.markSent(settled, dateIso)
        }
      }
    }
  }
  return tally
}

const TICK_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null

/** Starts the once-a-minute watcher on this worker. It acts only while the
 *  worker holds the leader lease, so alerts are never sent twice. Resolves
 *  false, and starts nothing, when the feature is not set up. */
export async function startPushWatcher(opts: { isLeader: () => boolean; origin: string }): Promise<boolean> {
  if (timer) return true
  // Imported here, not at the top: the pure tick above is then testable
  // without the file caches and the push library.
  const { pushConfig } = await import('./config')
  const config = pushConfig()
  if (!config) return false
  const { webPushSender } = await import('./sender')
  const store = await import('./store')
  const sentLog = await import('./sent-log')
  const { clubLookup } = await import('./clubs')
  const { recordPush } = await import('./stats')
  const { batDownSince } = await import('@/lib/bat-outages')
  const { getTodayIso } = await import('@/lib/today')
  const { listAllTournaments } = await import('@/lib/tournaments-registry')

  // The app's own schedule route, so the watcher shares the one-minute cache
  // with visitors and the warmer and never asks BAT itself.
  const fetchDay = async (tournamentId: string, dateIso: string): Promise<MatchScheduleGroup[] | null> => {
    const base = `${opts.origin}/api/matches?tournament=${encodeURIComponent(tournamentId)}`
    const full = await fetch(base)
    if (!full.ok) return null
    const day = ((await full.json()) as MatchesData).days?.find((d) => d.dateIso === dateIso)
    if (!day?.date) return null
    const res = await fetch(`${base}&date=${encodeURIComponent(day.date)}`)
    if (!res.ok) return null
    return ((await res.json()) as Pick<MatchesData, 'groups'>).groups ?? null
  }

  const deps: WatcherDeps = {
    now: () => Date.now(),
    todayIso: () => getTodayIso(),
    isBatDown: () => !!batDownSince(),
    listRecords: store.listRecords,
    isWatchable: (id) => listAllTournaments().some((t) => t.id.toUpperCase() === id && t.provider === 'bat' && !t.done),
    fetchDay,
    clubOf: async (tournamentId) => (await clubLookup(tournamentId)).clubOf,
    hasSent: sentLog.hasSent,
    markSent: sentLog.markSent,
    send: webPushSender(config),
    removeRecord: store.removeRecord,
    record: recordPush,
  }

  let busy = false
  let lastPruneDay = ''
  const loaded = sentLog.loadSentLog()
  timer = setInterval(async () => {
    if (busy || !opts.isLeader()) return
    busy = true
    try {
      await loaded
      const today = deps.todayIso()
      if (today !== lastPruneDay) {
        lastPruneDay = today
        await sentLog.pruneSent(today)
        await store.pruneStale(deps.now())
      }
      const r = await runWatcherTick(deps)
      if (r.sent || r.failed || r.gone) console.log(`[push] tick sent=${r.sent} failed=${r.failed} gone=${r.gone}`)
    } catch (err) {
      console.warn('[push] tick failed:', err instanceof Error ? err.message : err)
    } finally {
      busy = false
    }
  }, TICK_MS)
  timer.unref?.()
  console.log('[push] watcher started')
  return true
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/push-watcher.test.ts && npx tsc --noEmit`
Expected: PASS, 16 tests; no new type errors.

- [ ] **Step 6: Start it with the server**

In `instrumentation.ts`, directly after the two lines

```ts
    await renewLease()
    setInterval(renewLease, LEASE_HEARTBEAT_MS)
```

add:

```ts

    // Match alerts: once a minute, only on the worker that holds the lease.
    // Does nothing (and starts no timer) when the push keys are not set.
    try {
      const { startPushWatcher } = await import('./lib/push/watcher')
      await startPushWatcher({ isLeader: () => amLeader, origin: `http://127.0.0.1:${process.env.PORT || '3000'}` })
    } catch (err) {
      console.warn('[push] watcher failed to start:', err instanceof Error ? err.message : err)
    }
```

- [ ] **Step 7: Show the counts on the status page**

In `app/api/bmstats/route.ts`, add the imports beside the others:

```ts
import { getPushStats } from '@/lib/push/stats'
import { getTodayIso } from '@/lib/today'
```

and, on the line after `playerCache: getPlayerCacheStats(),` in the response object, add:

```ts
      push: getPushStats(getTodayIso()),
```

(If `getTodayIso` is already imported in that file, do not import it twice.)

In `components/BmStats.tsx`, add to `interface Status`, after the `playerCache?:` line:

```ts
  push?: { sentToday: number; failedToday: number; goneToday: number }
```

and, directly before the line `<Card title="BAT outages">`, add:

```tsx
        {status.push && (
          <Card title="Match alerts">
            <p className="bms-note">
              Sent today: <b>{num(status.push.sentToday)}</b> · failed: <b>{num(status.push.failedToday)}</b> · devices
              removed as gone: <b>{num(status.push.goneToday)}</b>.
            </p>
          </Card>
        )}
```

Check the class and helper names exist before saving:

```bash
grep -n "bms-note\|const num = \|function num(" components/BmStats.tsx app/globals.css | head
```

Expected: `num` is defined in `components/BmStats.tsx`. If `bms-note` is not a class in use, use the class of the paragraph inside the existing `playerCache` block (the `<p>` that holds "Player cache failures today") instead.

- [ ] **Step 8: Verify and commit**

Run: `npx jest __tests__/push-watcher.test.ts __tests__/bmstats-route.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS; no new type errors; no new lint warnings in the files touched.

```bash
git add lib/push/stats.ts lib/push/watcher.ts instrumentation.ts app/api/bmstats/route.ts components/BmStats.tsx __tests__/push-watcher.test.ts
git commit -m "feat(alerts): watch followed matches once a minute and send what is due"
```

---

### Task 7: Service worker and the browser side

**Files:**
- Create: `public/sw.js`, `lib/push/client.ts`
- Modify: `next.config.js` (headers for `/sw.js`)
- Test: `__tests__/push-client.test.ts`

**Interfaces:**
- Consumes: the API (Task 5); types (Task 1).
- Produces:
  ```ts
  export type PushEnvironment = 'ok' | 'unsupported' | 'needs-install' | 'in-app-browser'
  export function pushEnvironment(env: { userAgent: string; standalone: boolean; hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean }): PushEnvironment
  export function readEnvironment(): PushEnvironment
  export function urlBase64ToUint8Array(base64: string): Uint8Array
  export interface PushClient {
    environment(): PushEnvironment
    permission(): NotificationPermission
    publicKey(): Promise<string | null>
    currentSubscription(): Promise<PushSubscriptionJSON | null>
    subscribe(publicKey: string): Promise<PushSubscriptionJSON | 'denied' | null>
    follow(subscription: PushSubscriptionJSON, lang: Lang, target: FollowTarget): Promise<{ follows: PushFollow[] } | { error: string; reason?: string }>
    unfollow(endpoint: string, target: FollowTarget): Promise<PushFollow[] | null>
    state(endpoint: string): Promise<PushFollow[] | null>
  }
  export const browserPushClient: PushClient
  ```

- [ ] **Step 1: Write the service worker**

Create `public/sw.js`:

```js
// BATMatch service worker: match alerts only. It shows a pushed notification
// and opens the app when one is tapped. It does not handle `fetch`, so it
// never caches or serves a page or an asset.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_err) {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'BATMatch'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      renotify: true,
      icon: '/icons/icon-192.png?v=2',
      badge: '/icons/icon-192.png?v=2',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
```

In `next.config.js`, add a second entry to the array `headers()` returns, after the manifest entry:

```js
      {
        // The service worker must never be served stale, by the browser or by
        // Cloudflare, or an update would not reach devices.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/push-client.test.ts`:

```ts
import { pushEnvironment, urlBase64ToUint8Array } from '@/lib/push/client'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LINE = `${ANDROID} Line/14.5.1`
const FACEBOOK = `${IPHONE} [FBAN/FBIOS;FBAV/450.0.0;FBBV/1]`
const INSTAGRAM = `${ANDROID} Instagram 320.0.0.0 Android`

const all = { standalone: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true }

describe('pushEnvironment', () => {
  it('is ok on Android Chrome and on a desktop browser', () => {
    expect(pushEnvironment({ ...all, userAgent: ANDROID })).toBe('ok')
    expect(pushEnvironment({ ...all, userAgent: MAC })).toBe('ok')
  })

  it('asks an iPhone to install first, and is ok once installed', () => {
    expect(pushEnvironment({ ...all, userAgent: IPHONE, hasPushManager: false })).toBe('needs-install')
    expect(pushEnvironment({ ...all, userAgent: IPHONE })).toBe('needs-install')
    expect(pushEnvironment({ ...all, userAgent: IPHONE, standalone: true })).toBe('ok')
  })

  it('knows an installed iPhone too old for push', () => {
    expect(pushEnvironment({ ...all, userAgent: IPHONE, standalone: true, hasPushManager: false })).toBe('unsupported')
  })

  it.each([['LINE', LINE], ['Facebook', FACEBOOK], ['Instagram', INSTAGRAM]])('sends the %s in-app browser to a real browser', (_n, userAgent) => {
    expect(pushEnvironment({ ...all, userAgent })).toBe('in-app-browser')
    expect(pushEnvironment({ ...all, userAgent, hasPushManager: false, hasServiceWorker: false })).toBe('in-app-browser')
  })

  it('is unsupported without a service worker, push or notifications', () => {
    expect(pushEnvironment({ ...all, userAgent: MAC, hasServiceWorker: false })).toBe('unsupported')
    expect(pushEnvironment({ ...all, userAgent: MAC, hasPushManager: false })).toBe('unsupported')
    expect(pushEnvironment({ ...all, userAgent: MAC, hasNotification: false })).toBe('unsupported')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 with its padding left off', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest __tests__/push-client.test.ts`
Expected: FAIL — cannot find module `@/lib/push/client`.

- [ ] **Step 4: Implement**

Create `lib/push/client.ts`:

```ts
import type { Lang } from '@/lib/i18n'
import type { FollowTarget, PushFollow } from './types'

export type PushEnvironment = 'ok' | 'unsupported' | 'needs-install' | 'in-app-browser'

// Browsers built into other apps cannot register for push; the person has to
// open the page in Chrome or Safari.
const IN_APP = /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok/i

/** Whether this browser can get match alerts, and if not, what stands in the way. */
export function pushEnvironment(env: {
  userAgent: string
  standalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
}): PushEnvironment {
  if (IN_APP.test(env.userAgent)) return 'in-app-browser'
  const isIos = /iPad|iPhone|iPod/.test(env.userAgent)
  // On iPhone and iPad, push exists only for an app added to the home screen.
  if (isIos && !env.standalone) return 'needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  return 'ok'
}

export function readEnvironment(): PushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  const nav = navigator as Navigator & { standalone?: boolean }
  return pushEnvironment({
    userAgent: nav.userAgent,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
  })
}

/** The form `pushManager.subscribe` wants the server's public key in. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export interface PushClient {
  environment(): PushEnvironment
  permission(): NotificationPermission
  /** The server's public key, or null when match alerts are not set up. */
  publicKey(): Promise<string | null>
  currentSubscription(): Promise<PushSubscriptionJSON | null>
  /** Asks for permission if needed, then subscribes. */
  subscribe(publicKey: string): Promise<PushSubscriptionJSON | 'denied' | null>
  follow(subscription: PushSubscriptionJSON, lang: Lang, target: FollowTarget): Promise<{ follows: PushFollow[] } | { error: string; reason?: string }>
  unfollow(endpoint: string, target: FollowTarget): Promise<PushFollow[] | null>
  state(endpoint: string): Promise<PushFollow[] | null>
}

async function postJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

const registration = () => navigator.serviceWorker.register('/sw.js', { scope: '/' })

export const browserPushClient: PushClient = {
  environment: readEnvironment,
  permission: () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
  async publicKey() {
    try {
      const res = await fetch('/api/push/key')
      if (!res.ok) return null
      const key = ((await res.json()) as { publicKey?: unknown }).publicKey
      return typeof key === 'string' && key ? key : null
    } catch {
      return null
    }
  },
  async currentSubscription() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      return sub ? sub.toJSON() : null
    } catch {
      return null
    }
  },
  async subscribe(publicKey) {
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') return 'denied'
      const reg = await registration()
      await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
      return sub.toJSON()
    } catch {
      return null
    }
  },
  async follow(subscription, lang, target) {
    try {
      const { status, data } = await postJson('/api/push/follow', { subscription, lang, target })
      const d = (data ?? {}) as { follows?: PushFollow[]; error?: string; reason?: string }
      if (status === 200 && Array.isArray(d.follows)) return { follows: d.follows }
      return { error: d.error ?? `HTTP ${status}`, ...(d.reason && { reason: d.reason }) }
    } catch {
      return { error: 'network' }
    }
  },
  async unfollow(endpoint, target) {
    try {
      const { status, data } = await postJson('/api/push/unfollow', { endpoint, target })
      const follows = (data as { follows?: PushFollow[] } | null)?.follows
      return status === 200 && Array.isArray(follows) ? follows : null
    } catch {
      return null
    }
  },
  async state(endpoint) {
    try {
      const { status, data } = await postJson('/api/push/state', { endpoint })
      const follows = (data as { follows?: PushFollow[] } | null)?.follows
      return status === 200 && Array.isArray(follows) ? follows : null
    } catch {
      return null
    }
  },
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/push-client.test.ts && npx tsc --noEmit`
Expected: PASS, 8 tests; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js next.config.js lib/push/client.ts __tests__/push-client.test.ts
git commit -m "feat(alerts): push-only service worker and the browser side of following"
```

---

### Task 8: Follow state, strings and the player follow button

**Files:**
- Create: `lib/push/PushFollowsContext.tsx`, `lib/push/fake-client.ts` (test stand-in), `components/FollowButton.tsx`
- Modify: `lib/i18n.ts`, `app/layout.tsx`, `components/PlayerModal.tsx`, `app/page.tsx`, `app/globals.css`
- Test: `__tests__/PushFollowsContext.test.tsx`, `__tests__/FollowButton.test.tsx`

**Interfaces:**
- Consumes: `PushClient`, `browserPushClient`, `PushEnvironment` (Task 7); `normalizeClub` is NOT imported here (it pulls in Node's `crypto`); the context has its own one-line normaliser.
- Produces:
  ```ts
  export type FollowOutcome = 'ok' | 'denied' | 'limit' | 'error'
  export interface PushFollowsValue {
    /** 'off' until the server says the feature is set up. */
    status: 'off' | PushEnvironment
    permission: NotificationPermission
    follows: PushFollow[]
    isFollowingPlayer(tournamentId: string, playerId: string): boolean
    isFollowingClub(tournamentId: string, clubName: string | undefined): boolean
    follow(target: FollowTarget): Promise<FollowOutcome>
    unfollow(target: FollowTarget): Promise<void>
  }
  export function PushFollowsProvider(props: { children: ReactNode; client?: PushClient }): JSX.Element
  export function usePushFollows(): PushFollowsValue
  // components/FollowButton.tsx
  export default function FollowButton(props: { tournamentId: string; playerId: string; playerName: string; clubName?: string }): JSX.Element | null
  ```
  New `TKey`s: `followPlayer`, `followingPlayer`, `followingViaClub`, `followBlocked`, `followNeedsInstall`, `followInAppBrowser`, `followCopyLink`, `followLinkCopied`, `followLimit`, `followError`, `followClub`, `followingClub`, `followClubWarning`, `followingTitle`, `followingEmpty`, `unfollow`.

- [ ] **Step 1: Add the strings**

In `lib/i18n.ts`, add to the `TKey` union after `| 'alertsBellAria'`:

```ts
  | 'followPlayer'
  | 'followingPlayer'
  | 'followingViaClub'
  | 'followBlocked'
  | 'followNeedsInstall'
  | 'followInAppBrowser'
  | 'followCopyLink'
  | 'followLinkCopied'
  | 'followLimit'
  | 'followError'
  | 'followClub'
  | 'followingClub'
  | 'followClubWarning'
  | 'followingTitle'
  | 'followingEmpty'
  | 'unfollow'
```

In the `en` dictionary, after the `alertsBellAria: 'Notifications',` line:

```ts
    followPlayer: 'Follow',
    followingPlayer: 'Following',
    followingViaClub: 'Following (club)',
    followBlocked: 'Notifications are blocked for this site. Allow them in your browser\'s site settings, then tap Follow again.',
    followNeedsInstall: 'On iPhone, alerts need BATMatch on your home screen: tap Share, then "Add to Home Screen", and open it from there.',
    followInAppBrowser: 'Alerts do not work inside this app\'s browser. Open BATMatch in Chrome or Safari.',
    followCopyLink: 'Copy link',
    followLinkCopied: 'Link copied',
    followLimit: 'You are following as many as this device allows. Unfollow some first.',
    followError: 'Could not follow just now. Please try again.',
    followClub: 'Follow club',
    followingClub: 'Following club',
    followClubWarning: 'Every match by this club\'s players sends alerts. That can be many in a day.',
    followingTitle: 'Following',
    followingEmpty: 'Follow a player or a club to be told when their match is close.',
    unfollow: 'Unfollow',
```

In the `th` dictionary, after the `alertsBellAria: 'การแจ้งเตือน',` line:

```ts
    followPlayer: 'ติดตาม',
    followingPlayer: 'กำลังติดตาม',
    followingViaClub: 'กำลังติดตาม (สโมสร)',
    followBlocked: 'เว็บไซต์นี้ถูกปิดการแจ้งเตือน กรุณาอนุญาตในการตั้งค่าเว็บไซต์ของเบราว์เซอร์ แล้วแตะติดตามอีกครั้ง',
    followNeedsInstall: 'บน iPhone ต้องเพิ่ม BATMatch ไว้ที่หน้าจอโฮมก่อน: แตะแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" จากนั้นเปิดจากไอคอนนั้น',
    followInAppBrowser: 'การแจ้งเตือนใช้ไม่ได้ในเบราว์เซอร์ของแอปนี้ กรุณาเปิด BATMatch ใน Chrome หรือ Safari',
    followCopyLink: 'คัดลอกลิงก์',
    followLinkCopied: 'คัดลอกลิงก์แล้ว',
    followLimit: 'ติดตามครบจำนวนที่อุปกรณ์นี้รองรับแล้ว กรุณาเลิกติดตามบางรายการก่อน',
    followError: 'ติดตามไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    followClub: 'ติดตามสโมสร',
    followingClub: 'กำลังติดตามสโมสร',
    followClubWarning: 'ทุกแมตช์ของนักกีฬาสโมสรนี้จะมีการแจ้งเตือน ซึ่งอาจมีจำนวนมากในหนึ่งวัน',
    followingTitle: 'กำลังติดตาม',
    followingEmpty: 'ติดตามนักกีฬาหรือสโมสร เพื่อรับแจ้งเตือนเมื่อใกล้ถึงคิวแข่ง',
    unfollow: 'เลิกติดตาม',
```

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 2: Write the test helper and the failing tests**

Create `lib/push/fake-client.ts` (a test stand-in; it sits beside the real client because Jest treats every file under `__tests__/` as a test):

```ts
import type { PushClient } from './client'
import type { FollowTarget, PushFollow } from './types'

// A stand-in for the browser side of match alerts, for component tests: a
// server that remembers follows, and a browser that subscribes when asked.
// Lives beside the real client (not under __tests__, where Jest would take it
// for a test file). Nothing in the app imports it.

export const FAKE_SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }

const asFollow = (t: FollowTarget): PushFollow =>
  t.kind === 'player'
    ? { kind: 'player', tournamentId: t.tournamentId, playerId: t.playerId, playerName: t.playerName ?? '', addedAt: '' }
    : { kind: 'club', tournamentId: t.tournamentId, clubName: t.clubName, addedAt: '' }

const same = (f: PushFollow, t: FollowTarget) =>
  f.kind === t.kind && f.tournamentId === t.tournamentId &&
  (f.kind === 'player' && t.kind === 'player' ? f.playerId === t.playerId : f.kind === 'club' && t.kind === 'club' ? f.clubName === t.clubName : false)

export function fakeClient(over: Partial<PushClient> = {}): PushClient & { calls: string[] } {
  const calls: string[] = []
  let server: PushFollow[] = []
  let subscribed = false
  const client: PushClient & { calls: string[] } = {
    calls,
    environment: () => 'ok',
    permission: () => (subscribed ? 'granted' : 'default'),
    publicKey: async () => 'PUB',
    currentSubscription: async () => (subscribed ? FAKE_SUBSCRIPTION : null),
    subscribe: async () => { calls.push('subscribe'); subscribed = true; return FAKE_SUBSCRIPTION },
    follow: async (_s, lang, target) => { calls.push(`follow:${lang}`); server = [...server, asFollow(target)]; return { follows: server } },
    unfollow: async (_e, target) => {
      calls.push('unfollow')
      server = server.filter((f) => !same(f, target))
      return server
    },
    state: async () => { calls.push('state'); return server },
    ...over,
  }
  return client
}
```

Create `__tests__/PushFollowsContext.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { PushFollowsProvider, usePushFollows, type PushFollowsValue } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient, FAKE_SUBSCRIPTION as SUB } from '@/lib/push/fake-client'
import type { FollowTarget } from '@/lib/push/types'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const PLAYER: FollowTarget = { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' }
let value: PushFollowsValue
function Probe() {
  value = usePushFollows()
  return <span data-testid="status">{value.status}</span>
}
const mount = (client: PushClient) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><Probe /></PushFollowsProvider></LanguageProvider>)

describe('PushFollowsProvider', () => {
  it('is off until the server says the feature is set up, then reports the browser', async () => {
    mount(fakeClient())
    expect(screen.getByTestId('status').textContent).toBe('off')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ok'))
  })

  it('stays off when the server has no key', async () => {
    const client = fakeClient({ publicKey: async () => null })
    mount(client)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('status').textContent).toBe('off')
    expect(client.calls).toEqual([])
  })

  it('reports what stands in the way on an iPhone or in an in-app browser', async () => {
    mount(fakeClient({ environment: () => 'needs-install' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('needs-install'))
  })

  it('never subscribes or asks permission on load', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    expect(client.calls).not.toContain('subscribe')
  })

  it('reads back the follows of a device already subscribed', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(SUB, 'en', PLAYER)
    client.calls.length = 0
    mount(client)
    await waitFor(() => expect(value.follows).toHaveLength(1))
    expect(value.isFollowingPlayer(TID.toLowerCase(), '1')).toBe(true)
    expect(value.isFollowingPlayer(TID, '2')).toBe(false)
  })

  it('follow subscribes first, then follows, in the page language', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('ok')
    expect(client.calls).toEqual(['subscribe', 'follow:en'])
    expect(value.isFollowingPlayer(TID, '1')).toBe(true)
  })

  it('a denied prompt stores nothing and says so', async () => {
    const client = fakeClient({ subscribe: async () => 'denied' })
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('denied')
    expect(client.calls).not.toContain('follow:en')
    expect(value.follows).toEqual([])
  })

  it('reports the limit, and any other failure, without changing the list', async () => {
    const limited = fakeClient({ follow: async () => ({ error: 'follow limit reached', reason: 'player-limit' }) })
    mount(limited)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('limit')
    expect(value.follows).toEqual([])
  })

  it('a failed subscribe is an error, not a denial', async () => {
    mount(fakeClient({ subscribe: async () => null }))
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('error')
  })

  it('unfollows', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    await act(async () => { await value.follow(PLAYER) })
    await act(async () => { await value.unfollow(PLAYER) })
    expect(value.follows).toEqual([])
  })

  it('knows a followed club whatever the case or spacing', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    await act(async () => { await value.follow({ kind: 'club', tournamentId: TID, clubName: 'Red Club' }) })
    expect(value.isFollowingClub(TID, '  red   CLUB ')).toBe(true)
    expect(value.isFollowingClub(TID, 'Blue Club')).toBe(false)
    expect(value.isFollowingClub(TID, undefined)).toBe(false)
  })

  it('works without a provider: everything is off', () => {
    render(<Probe />)
    expect(value.status).toBe('off')
    expect(value.isFollowingPlayer(TID, '1')).toBe(false)
  })
})
```

Create `__tests__/FollowButton.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FollowButton from '@/components/FollowButton'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient } from '@/lib/push/fake-client'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
import { track } from '@/lib/analytics'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'

const mount = (client: PushClient, props: Partial<React.ComponentProps<typeof FollowButton>> = {}) =>
  render(
    <LanguageProvider>
      <PushFollowsProvider client={client}>
        <FollowButton tournamentId={TID} playerId="1" playerName="Anan Dee" {...props} />
      </PushFollowsProvider>
    </LanguageProvider>,
  )

const button = () => document.querySelector<HTMLButtonElement>('.follow-btn')
const note = () => document.querySelector('.follow-note')?.textContent ?? ''

beforeEach(() => { (track as jest.Mock).mockReset(); localStorage.clear() })

describe('FollowButton', () => {
  it('is not shown while the feature is off or the browser cannot do push', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(button()).toBeNull()
    document.body.innerHTML = ''
    mount(fakeClient({ environment: () => 'unsupported' }))
    await waitFor(() => expect(button()).toBeNull())
  })

  it('follows on tap and then reads "Following"', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()?.textContent).toContain('Follow'))
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following'))
    expect(button()!.getAttribute('aria-pressed')).toBe('true')
    expect(track).toHaveBeenCalledWith('match_alert_followed', { tournament_id: TID, kind: 'player', player_id: '1' })
  })

  it('unfollows on a second tap', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('false'))
    expect(track).toHaveBeenCalledWith('match_alert_unfollowed', { tournament_id: TID, kind: 'player', player_id: '1' })
  })

  it('explains a denied prompt', async () => {
    mount(fakeClient({ subscribe: async () => 'denied' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    expect(track).toHaveBeenCalledWith('match_alert_blocked', { reason: 'denied' })
  })

  it('explains notifications already blocked, without asking again', async () => {
    const client = fakeClient({ permission: () => 'denied' })
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
    expect(client.calls).not.toContain('subscribe')
  })

  it('tells an iPhone user to install first, and does not try to subscribe', async () => {
    const client = fakeClient({ environment: () => 'needs-install' })
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('home screen'))
    expect(client.calls).not.toContain('subscribe')
    expect(track).toHaveBeenCalledWith('match_alert_blocked', { reason: 'needs-install' })
  })

  it('tells an in-app browser user to open a real browser, and offers the link', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    mount(fakeClient({ environment: () => 'in-app-browser' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('Chrome or Safari'))
    fireEvent.click(screen.getByText('Copy link'))
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`tournament=${TID}`))
  })

  it('says so at the limit and on any other failure', async () => {
    mount(fakeClient({ follow: async () => ({ error: 'x', reason: 'player-limit' }) }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('Unfollow some first'))
    document.body.innerHTML = ''
    mount(fakeClient({ follow: async () => ({ error: 'network' }) }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('try again'))
  })

  it('reads "Following (club)" for a member of a followed club, and does not unfollow on tap', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, 'en', { kind: 'club', tournamentId: TID, clubName: 'Red Club' })
    client.calls.length = 0
    mount(client, { clubName: 'red club' })
    await waitFor(() => expect(button()?.textContent).toContain('Following (club)'))
    fireEvent.click(button()!)
    await Promise.resolve()
    expect(client.calls).not.toContain('unfollow')
    expect(client.calls).not.toContain('follow:en')
  })

  it('is written in Thai', async () => {
    localStorage.setItem('batbracket.lang', 'th')
    mount(fakeClient())
    await waitFor(() => expect(button()?.textContent).toContain('ติดตาม'))
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest __tests__/PushFollowsContext.test.tsx __tests__/FollowButton.test.tsx`
Expected: FAIL — the context and the button do not exist.

- [ ] **Step 4: Implement the context**

Create `lib/push/PushFollowsContext.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { browserPushClient, type PushClient, type PushEnvironment } from './client'
import type { FollowTarget, PushFollow } from './types'

export type FollowOutcome = 'ok' | 'denied' | 'limit' | 'error'

export interface PushFollowsValue {
  /** 'off' until the server says match alerts are set up. */
  status: 'off' | PushEnvironment
  permission: NotificationPermission
  follows: PushFollow[]
  isFollowingPlayer(tournamentId: string, playerId: string): boolean
  isFollowingClub(tournamentId: string, clubName: string | undefined): boolean
  follow(target: FollowTarget): Promise<FollowOutcome>
  unfollow(target: FollowTarget): Promise<void>
}

// The same rule the server uses for club names (lib/push/alerts.ts), kept
// here so the browser bundle does not pull in the server's hashing.
const clubKey = (name: string | undefined) => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

const OFF: PushFollowsValue = {
  status: 'off',
  permission: 'default',
  follows: [],
  isFollowingPlayer: () => false,
  isFollowingClub: () => false,
  follow: async () => 'error',
  unfollow: async () => {},
}

const Ctx = createContext<PushFollowsValue>(OFF)

export function usePushFollows(): PushFollowsValue {
  return useContext(Ctx)
}

/** What this device follows, shared by every follow control and the list.
 *  Loading only reads: it never asks for permission or subscribes. */
export function PushFollowsProvider({ children, client = browserPushClient }: { children: ReactNode; client?: PushClient }) {
  const { lang } = useLanguage()
  const [status, setStatus] = useState<PushFollowsValue['status']>('off')
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [follows, setFollows] = useState<PushFollow[]>([])
  const keyRef = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const key = await client.publicKey()
      if (!live || !key) return
      keyRef.current = key
      const environment = client.environment()
      setStatus(environment)
      if (environment !== 'ok') return
      setPermission(client.permission())
      const sub = await client.currentSubscription()
      if (!live || !sub?.endpoint) return
      const known = await client.state(sub.endpoint)
      if (live && known) setFollows(known)
    })()
    return () => { live = false }
  }, [client])

  const follow = useCallback(async (target: FollowTarget): Promise<FollowOutcome> => {
    const key = keyRef.current
    if (!key || client.environment() !== 'ok') return 'error'
    if (client.permission() === 'denied') { setPermission('denied'); return 'denied' }
    const sub = await client.subscribe(key)
    setPermission(client.permission())
    if (sub === 'denied') return 'denied'
    if (!sub) return 'error'
    const result = await client.follow(sub, lang, target)
    if ('follows' in result) { setFollows(result.follows); return 'ok' }
    return result.reason ? 'limit' : 'error'
  }, [client, lang])

  const unfollow = useCallback(async (target: FollowTarget): Promise<void> => {
    const sub = await client.currentSubscription()
    if (!sub?.endpoint) return
    const next = await client.unfollow(sub.endpoint, target)
    if (next) setFollows(next)
  }, [client])

  const value = useMemo<PushFollowsValue>(() => ({
    status,
    permission,
    follows,
    isFollowingPlayer: (tournamentId, playerId) =>
      follows.some((f) => f.kind === 'player' && f.tournamentId === tournamentId.toUpperCase() && f.playerId === playerId),
    isFollowingClub: (tournamentId, clubName) => {
      const want = clubKey(clubName)
      return !!want && follows.some((f) => f.kind === 'club' && f.tournamentId === tournamentId.toUpperCase() && clubKey(f.clubName) === want)
    },
    follow,
    unfollow,
  }), [status, permission, follows, follow, unfollow])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
```

- [ ] **Step 5: Implement the button**

Create `components/FollowButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import type { TKey } from '@/lib/i18n'

interface Props {
  tournamentId: string
  playerId: string
  playerName: string
  /** The player's club in this tournament, to show a club follow that covers them. */
  clubName?: string
}

export const BELL = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

/** Follow one player in one tournament. The permission prompt appears only
 *  after a tap here. Hidden where alerts cannot work at all. */
export default function FollowButton({ tournamentId, playerId, playerName, clubName }: Props) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  if (push.status === 'off' || push.status === 'unsupported') return null

  const direct = push.isFollowingPlayer(tournamentId, playerId)
  const viaClub = !direct && push.isFollowingClub(tournamentId, clubName)
  const label = direct ? t('followingPlayer') : viaClub ? t('followingViaClub') : t('followPlayer')
  const props = { tournament_id: tournamentId, kind: 'player', player_id: playerId }

  const blocked = (reason: string, key: TKey) => {
    track('match_alert_blocked', { reason })
    setNote(key)
  }

  const onClick = async () => {
    if (busy) return
    setNote(null)
    // A club follow covers this player; it is undone from the Following list.
    if (viaClub) return
    if (push.status === 'needs-install') return blocked('needs-install', 'followNeedsInstall')
    if (push.status === 'in-app-browser') return blocked('in-app-browser', 'followInAppBrowser')
    setBusy(true)
    try {
      if (direct) {
        await push.unfollow({ kind: 'player', tournamentId, playerId })
        track('match_alert_unfollowed', props)
        return
      }
      if (push.permission === 'denied') return blocked('denied', 'followBlocked')
      const outcome = await push.follow({ kind: 'player', tournamentId, playerId, playerName })
      if (outcome === 'ok') track('match_alert_followed', props)
      else if (outcome === 'denied') blocked('denied', 'followBlocked')
      else setNote(outcome === 'limit' ? 'followLimit' : 'followError')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?tournament=${tournamentId}`)
      setCopied(true)
    } catch { /* nothing to copy with: the note already says what to do */ }
  }

  return (
    <div className="follow-wrap">
      <button
        type="button"
        className={`follow-btn${direct || viaClub ? ' follow-btn--on' : ''}`}
        aria-pressed={direct || viaClub}
        disabled={busy}
        onClick={onClick}
      >
        {BELL}
        <span>{label}</span>
      </button>
      {note && (
        <div className="follow-note" role="status">
          {t(note)}
          {note === 'followInAppBrowser' && (
            <button type="button" className="follow-copy" onClick={copyLink}>{copied ? t('followLinkCopied') : t('followCopyLink')}</button>
          )}
        </div>
      )}
    </div>
  )
}
```

Append to `app/globals.css`:

```css
/* Match alerts: follow controls */
.follow-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.follow-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--text-scale));
  font-weight: 600;
  color: var(--brand-fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 4px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.follow-btn:hover { background: var(--border); }
.follow-btn:disabled { opacity: 0.6; cursor: default; }

.follow-btn--on {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.follow-btn--on:hover { background: var(--brand); }

.follow-note {
  font-size: calc(12px * var(--text-scale));
  color: var(--muted);
  max-width: 44ch;
}

.follow-copy {
  margin-left: 8px;
  font-size: inherit;
  font-weight: 600;
  color: var(--brand-fg);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
}

.following-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.following-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: calc(13px * var(--text-scale));
}

.following-where {
  color: var(--muted);
  font-size: calc(11px * var(--text-scale));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/PushFollowsContext.test.tsx __tests__/FollowButton.test.tsx`
Expected: PASS, 12 + 10 tests.

- [ ] **Step 7: Mount the provider and place the button**

In `app/layout.tsx`, import the provider beside the other providers:

```ts
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
```

and wrap what `<PresenceProvider>` holds:

```tsx
              <PresenceProvider>
                <PushFollowsProvider>
                  <SearchAliasesLoader />
                  {children}
                  {/* Sits in the root layout so the disclaimer is reachable from
                      every route — the tournament view, leaderboards, player
                      profiles and the country matrix alike. */}
                  <AppFooter />
                  <IOSInstallBanner />
                </PushFollowsProvider>
              </PresenceProvider>
```

In `components/PlayerModal.tsx`, add the import:

```ts
import FollowButton from '@/components/FollowButton'
```

add to `interface Props`, after `onPathClick?:`:

```ts
  /** The tournament the player window is open on; with it, a follow button is shown. */
  tournamentId?: string
```

add `tournamentId` to the destructured props of `PlayerModal`, and, directly after the closing `)}` of the `{fullProfile && ( … )}` block inside `.pm-header`, add:

```tsx
              {tournamentId && profile.playerId && (provider ?? 'bat') === 'bat' && (
                <FollowButton tournamentId={tournamentId} playerId={profile.playerId} playerName={profile.name} clubName={profile.club || undefined} />
              )}
```

In `app/page.tsx`, on the `<PlayerModal … />` element (the one given `profile={modalProfile}`), add:

```tsx
          tournamentId={selectedTournament || undefined}
```

- [ ] **Step 8: Verify and commit**

Run: `npx jest __tests__/PlayerModal.path.test.tsx __tests__/FollowButton.test.tsx __tests__/PushFollowsContext.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS; no new type errors or lint warnings. (`PlayerModal.path.test.tsx` renders `PlayerModal` without a provider and without `tournamentId`, so no follow button appears there.)

```bash
git add lib/i18n.ts lib/push/PushFollowsContext.tsx lib/push/fake-client.ts components/FollowButton.tsx app/globals.css app/layout.tsx components/PlayerModal.tsx app/page.tsx __tests__/PushFollowsContext.test.tsx __tests__/FollowButton.test.tsx
git commit -m "feat(alerts): follow a player from the player window"
```

---

### Task 9: Follow a club, and the Following list

**Files:**
- Create: `components/FollowClubButton.tsx`, `components/FollowingList.tsx`
- Modify: `components/RosterModal.tsx`, `components/ClubRosterModal.tsx`, `components/TournamentStatsPanel.tsx`, `components/AlertBell.tsx`, `app/page.tsx`
- Test: `__tests__/FollowClubButton.test.tsx`, `__tests__/FollowingList.test.tsx`, `__tests__/AlertBell.following.test.tsx`

**Interfaces:**
- Consumes: `usePushFollows`, `PushFollowsProvider` (Task 8); `BELL` from `@/components/FollowButton`; `fakeClient` from `@/lib/push/fake-client`.
- Produces:
  ```ts
  export default function FollowClubButton(props: { tournamentId: string; clubName: string }): JSX.Element | null
  export default function FollowingList(props: { tournamentNames: Record<string, string> }): JSX.Element | null
  // AlertBell gains one optional prop
  following?: ReactNode
  hasFollowing?: boolean
  // ClubRosterModal gains one optional prop
  tournamentId?: string
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/FollowClubButton.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, fireEvent, waitFor } from '@testing-library/react'
import FollowClubButton from '@/components/FollowClubButton'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient } from '@/lib/push/fake-client'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
import { track } from '@/lib/analytics'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const mount = (client: PushClient) =>
  render(
    <LanguageProvider>
      <PushFollowsProvider client={client}>
        <FollowClubButton tournamentId={TID} clubName="Red Club" />
      </PushFollowsProvider>
    </LanguageProvider>,
  )
const button = () => document.querySelector<HTMLButtonElement>('.follow-btn')
const note = () => document.querySelector('.follow-note')?.textContent ?? ''

beforeEach(() => { (track as jest.Mock).mockReset(); localStorage.clear() })

describe('FollowClubButton', () => {
  it('is hidden while the feature is off', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(button()).toBeNull()
  })

  it('warns about the number of alerts on the first tap, and follows on the second', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Follow club'))
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('many in a day'))
    expect(client.calls).not.toContain('follow:en')
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following club'))
    expect(track).toHaveBeenCalledWith('match_alert_followed', { tournament_id: TID, kind: 'club', club: 'Red Club' })
  })

  it('does not warn again on a device that has seen the warning', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following club'))
  })

  it('unfollows on a tap when following', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('false'))
    expect(track).toHaveBeenCalledWith('match_alert_unfollowed', { tournament_id: TID, kind: 'club', club: 'Red Club' })
  })

  it('explains an iPhone that needs installing, with no warning step first', async () => {
    mount(fakeClient({ environment: () => 'needs-install' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('home screen'))
  })

  it('explains a denied prompt', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient({ subscribe: async () => 'denied' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
  })
})
```

Create `__tests__/FollowingList.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FollowingList from '@/components/FollowingList'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import { fakeClient } from '@/lib/push/fake-client'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const SUB = { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }
const names = { [TID]: 'The Open 2026' }

async function seeded() {
  const client = fakeClient()
  await client.subscribe('PUB')
  await client.follow(SUB, 'en', { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' })
  await client.follow(SUB, 'en', { kind: 'club', tournamentId: TID, clubName: 'Red Club' })
  return client
}

const mount = (client: ReturnType<typeof fakeClient>) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><FollowingList tournamentNames={names} /></PushFollowsProvider></LanguageProvider>)

const rows = () => Array.from(document.querySelectorAll('.following-row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim())

describe('FollowingList', () => {
  it('renders nothing while the feature is off', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(document.querySelector('.following')).toBeNull()
  })

  it('says how to start when nothing is followed', async () => {
    mount(fakeClient())
    await waitFor(() => expect(screen.getByText(/Follow a player or a club/)).toBeTruthy())
  })

  it('lists clubs first, then players, each with its tournament', async () => {
    mount(await seeded())
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0]).toContain('Red Club')
    expect(rows()[0]).toContain('The Open 2026')
    expect(rows()[1]).toContain('Anan Dee')
  })

  it('falls back to no tournament name when it is not known', async () => {
    const client = await seeded()
    render(<LanguageProvider><PushFollowsProvider client={client}><FollowingList tournamentNames={{}} /></PushFollowsProvider></LanguageProvider>)
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[1]).toContain('Anan Dee')
  })

  it('unfollows one row and keeps the other', async () => {
    mount(await seeded())
    await waitFor(() => expect(rows()).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: /Unfollow/ })[1])
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toContain('Red Club')
  })
})
```

Create `__tests__/AlertBell.following.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import AlertBell from '@/components/AlertBell'
import { LanguageProvider } from '@/lib/LanguageContext'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))

const bell = () => screen.getByRole('button', { name: 'Notifications' })
const mount = (props: Partial<React.ComponentProps<typeof AlertBell>>) =>
  render(<LanguageProvider><AlertBell alerts={[]} onDismiss={() => {}} {...props} /></LanguageProvider>)

describe('AlertBell with a following list', () => {
  it('stays inert with no alerts and no following list', () => {
    mount({})
    fireEvent.click(bell())
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens to show the following list even with no alerts', () => {
    mount({ hasFollowing: true, following: <div data-testid="following">mine</div> })
    expect(bell().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(bell())
    expect(screen.getByTestId('following')).toBeTruthy()
  })

  it('does not show the unread dot for the following list alone', () => {
    mount({ hasFollowing: true, following: <div>mine</div> })
    expect(document.querySelector('.alert-bell-dot')).toBeNull()
  })

  it('does not clear alerts when closed with only the following list open', () => {
    const onDismiss = jest.fn()
    mount({ hasFollowing: true, following: <div>mine</div>, onDismiss })
    fireEvent.click(bell())
    fireEvent.mouseDown(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest __tests__/FollowClubButton.test.tsx __tests__/FollowingList.test.tsx __tests__/AlertBell.following.test.tsx`
Expected: FAIL — the two components do not exist, and `AlertBell` has no `following` prop.

- [ ] **Step 3: Implement the club button and the list**

Create `components/FollowClubButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import { BELL } from '@/components/FollowButton'
import type { TKey } from '@/lib/i18n'

const WARNED_KEY = 'batbracket.followClubWarned'

function wasWarned(): boolean {
  try { return localStorage.getItem(WARNED_KEY) === '1' } catch { return true }
}

/** Follow every player a club has in one tournament. The first time on a
 *  device, the first tap only says how many alerts that can mean. */
export default function FollowClubButton({ tournamentId, clubName }: { tournamentId: string; clubName: string }) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)

  if (push.status === 'off' || push.status === 'unsupported') return null

  const on = push.isFollowingClub(tournamentId, clubName)
  const props = { tournament_id: tournamentId, kind: 'club', club: clubName }
  const blocked = (reason: string, key: TKey) => {
    track('match_alert_blocked', { reason })
    setNote(key)
  }

  const onClick = async () => {
    if (busy) return
    if (push.status === 'needs-install') return blocked('needs-install', 'followNeedsInstall')
    if (push.status === 'in-app-browser') return blocked('in-app-browser', 'followInAppBrowser')
    if (!on && !wasWarned()) {
      try { localStorage.setItem(WARNED_KEY, '1') } catch { /* asked every time, then */ }
      setNote('followClubWarning')
      return
    }
    setNote(null)
    setBusy(true)
    try {
      if (on) {
        await push.unfollow({ kind: 'club', tournamentId, clubName })
        track('match_alert_unfollowed', props)
        return
      }
      if (push.permission === 'denied') return blocked('denied', 'followBlocked')
      const outcome = await push.follow({ kind: 'club', tournamentId, clubName })
      if (outcome === 'ok') track('match_alert_followed', props)
      else if (outcome === 'denied') blocked('denied', 'followBlocked')
      else setNote(outcome === 'limit' ? 'followLimit' : 'followError')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="follow-wrap">
      <button type="button" className={`follow-btn${on ? ' follow-btn--on' : ''}`} aria-pressed={on} disabled={busy} onClick={onClick}>
        {BELL}
        <span>{on ? t('followingClub') : t('followClub')}</span>
      </button>
      {note && <div className="follow-note" role="status">{t(note)}</div>}
    </div>
  )
}
```

Create `components/FollowingList.tsx`:

```tsx
'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import type { PushFollow } from '@/lib/push/types'

/** What this device follows, clubs first, each with a way to stop. Renders
 *  nothing where match alerts cannot work. */
export default function FollowingList({ tournamentNames }: { tournamentNames: Record<string, string> }) {
  const { t } = useLanguage()
  const push = usePushFollows()
  if (push.status !== 'ok') return null

  const sorted = push.follows.slice().sort((a, b) => Number(b.kind === 'club') - Number(a.kind === 'club'))
  const nameOf = (f: PushFollow) => (f.kind === 'club' ? f.clubName : f.playerName)

  const stop = async (f: PushFollow) => {
    if (f.kind === 'club') {
      await push.unfollow({ kind: 'club', tournamentId: f.tournamentId, clubName: f.clubName })
      track('match_alert_unfollowed', { tournament_id: f.tournamentId, kind: 'club', club: f.clubName })
    } else {
      await push.unfollow({ kind: 'player', tournamentId: f.tournamentId, playerId: f.playerId })
      track('match_alert_unfollowed', { tournament_id: f.tournamentId, kind: 'player', player_id: f.playerId })
    }
  }

  return (
    <div className="following">
      <div className="pm-section-title">{t('followingTitle')}</div>
      {sorted.length === 0 ? (
        <div className="following-where">{t('followingEmpty')}</div>
      ) : (
        <ul className="following-list">
          {sorted.map((f) => (
            <li className="following-row" key={`${f.kind}:${f.tournamentId}:${f.kind === 'club' ? f.clubName : f.playerId}`}>
              <span>
                <span>{nameOf(f)}</span>
                {tournamentNames[f.tournamentId] && <span className="following-where"> · {tournamentNames[f.tournamentId]}</span>}
              </span>
              <button type="button" className="follow-copy" aria-label={`${t('unfollow')} ${nameOf(f)}`} onClick={() => void stop(f)}>
                {t('unfollow')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Let the bell open for the list**

In `components/AlertBell.tsx`:

Change the React import and the props:

```ts
import { useEffect, useRef, useState, type ReactNode } from 'react'
```

```ts
interface AlertBellProps {
  alerts: AlertItem[]
  onDismiss: () => void
  /** The Following list, shown under the alerts. */
  following?: ReactNode
  /** Whether there is a Following list to open the panel for. */
  hasFollowing?: boolean
}
```

Change the function signature to `export default function AlertBell({ alerts, onDismiss, following, hasFollowing = false }: AlertBellProps) {`, and directly after `const showPulse = hasAlerts && !open` add:

```ts
  // The panel opens for alerts or for the Following list; only alerts light the dot.
  const canOpen = hasAlerts || hasFollowing
```

In `dismissWith`, make it close without clearing when there is nothing to clear. Replace its first lines so it reads:

```ts
  const dismissWith = (via: 'item' | 'outside' | 'escape') => {
    setOpen(false)
    if (!hasAlerts) return
    const tournaments = alerts.filter((a) => a.kind === 'tournament').length
    const schedules = alerts.filter((a) => a.kind === 'schedule').length
    const rankings = alerts.filter((a) => a.kind === 'ranking').length
    track('alert_dismissed', { count: alerts.length, tournaments, schedules, rankings, via })
```

and remove the later `setOpen(false)` that followed the `track` call in that function, keeping the rest (the call to `onDismiss`) as it is.

In `handleBellClick`, replace `if (!hasAlerts) return` with `if (!canOpen) return`, and wrap the `track('alert_opened', …)` block so it only runs with alerts: change `if (!open) {` to `if (!open && hasAlerts) {`.

On the bell `<button>`, replace the two `hasAlerts` uses that decide whether it is active:

```tsx
        aria-disabled={canOpen ? undefined : true}
```

```tsx
          canOpen ? 'text-[var(--fg)] hover:bg-[var(--bg)] cursor-pointer' : 'text-[var(--muted)] cursor-default'
```

Leave `{hasAlerts && <span className="alert-bell-dot" aria-hidden />}` as it is.

Inside the dropdown (the element rendered under `{open && (`), after the last alert section and before the dropdown's closing tag, add:

```tsx
            {following}
```

Before saving, read the dropdown block (`sed -n '/open && (/,/^      )}/p' components/AlertBell.tsx`) and place `{following}` as the last child of the panel element that holds the alert sections, so it shares the panel's padding.

- [ ] **Step 5: Wire the club button and the list**

`RosterModal` renders `title` inside one line of heading text (`{title} · {count} players`), so the control goes beside that line, not inside it. In `components/RosterModal.tsx`, add to `interface Props`, after `nameTitle?:`:

```ts
  // Optional control shown under the title line (the club modal's follow button).
  headerAction?: ReactNode
```

add `headerAction` to the component's destructured props, and inside `<div className="pm-header">`, directly after the closing `</div>` of the `pm-section-title` element, add:

```tsx
          {headerAction}
```

In `components/ClubRosterModal.tsx`, add the import and the prop, and pass the button as that control:

```ts
import FollowClubButton from '@/components/FollowClubButton'
```

```ts
interface Props {
  roster: StatsClubRoster | null
  onClose: () => void
  /** With it, the window offers to follow the whole club in this tournament. */
  tournamentId?: string
}
```

Change the signature to `export default function ClubRosterModal({ roster, onClose, tournamentId }: Props) {` and the returned element to:

```tsx
  return (
    <RosterModal
      open
      title={roster.club}
      count={roster.players}
      rows={rows}
      onClose={onClose}
      headerAction={tournamentId ? <FollowClubButton tournamentId={tournamentId} clubName={roster.club} /> : undefined}
    />
  )
```

In `components/TournamentStatsPanel.tsx`, pass the id through:

```tsx
      <ClubRosterModal roster={selectedClub} onClose={() => setSelectedClub(null)} tournamentId={tournamentId} />
```

In `app/page.tsx`, add the import:

```ts
import FollowingList from '@/components/FollowingList'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
```

inside the page component, beside the other hooks near the top, add:

```ts
  const pushFollows = usePushFollows()
  const tournamentNames = useMemo(
    () => Object.fromEntries(tournaments.map((x) => [x.id.toUpperCase(), x.name])),
    [tournaments],
  )
```

(if `useMemo` is not yet imported from `react` in this file, add it to the existing React import), and change the bell to:

```tsx
            <AlertBell
              alerts={alerts}
              onDismiss={() => setAlerts(dismissAlerts())}
              hasFollowing={pushFollows.status === 'ok'}
              following={<FollowingList tournamentNames={tournamentNames} />}
            />
```

- [ ] **Step 6: Verify and commit**

Run: `npx jest __tests__/FollowClubButton.test.tsx __tests__/FollowingList.test.tsx __tests__/AlertBell.following.test.tsx __tests__/AlertBell.test.tsx __tests__/ClubRosterModal.test.tsx __tests__/RosterModal.test.tsx __tests__/CountryRosterModal.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, including the existing `AlertBell` and `ClubRosterModal` tests unchanged; no new type errors or lint warnings.

```bash
git add components/FollowClubButton.tsx components/FollowingList.tsx components/RosterModal.tsx components/ClubRosterModal.tsx components/TournamentStatsPanel.tsx components/AlertBell.tsx app/page.tsx __tests__/FollowClubButton.test.tsx __tests__/FollowingList.test.tsx __tests__/AlertBell.following.test.tsx
git commit -m "feat(alerts): follow a whole club, and a list of what is followed"
```

---

### Task 10: Privacy notice and deployment notes

**Files:**
- Modify: `lib/privacy.ts`, `DEPLOY.md`
- Test: `__tests__/Privacy.test.tsx` (add one test)

**Interfaces:**
- Consumes: `PRIVACY` in `lib/privacy.ts` (`Record<Lang, { title, sections: { heading, body }[] }>`).
- Produces: one new section in each language, placed before the "Your choices" / its Thai equivalent section.

- [ ] **Step 1: Write the failing test**

Add to `__tests__/Privacy.test.tsx`, inside its top-level `describe` (or as a new `describe` at the end of the file if it has none):

```tsx
  it('says what following a player or a club stores, in both languages', () => {
    const { PRIVACY } = jest.requireActual('@/lib/privacy') as typeof import('@/lib/privacy')
    const en = PRIVACY.en.sections.find((s) => s.heading === 'Match alerts')
    const th = PRIVACY.th.sections.find((s) => s.heading === 'การแจ้งเตือนแมตช์')
    expect(en?.body).toMatch(/push address/)
    expect(en?.body).toMatch(/players and clubs/)
    expect(en?.body).toMatch(/60 days/)
    expect(th?.body).toMatch(/60 วัน/)
    expect(PRIVACY.en.sections.length).toBe(PRIVACY.th.sections.length)
  })
```

Run: `npx jest __tests__/Privacy.test.tsx`
Expected: FAIL — no "Match alerts" section.

- [ ] **Step 2: Add the sections**

In `lib/privacy.ts`, in the `en` sections array, directly before the object whose `heading` is `'Your choices'`, add:

```ts
      {
        heading: 'Match alerts',
        body:
          'If you follow a player or a club to be told when their match is close, our server stores your browser\'s push address (an address your browser creates so notifications can reach this device) and the list of players and clubs you follow. It is used only to send those alerts. It is not linked to your name or to any account. Unfollowing everything deletes it, and a device we have not seen for 60 days is removed automatically.',
      },
```

In the `th` sections array, at the same position (before the section that corresponds to "Your choices", the seventh entry), add:

```ts
      {
        heading: 'การแจ้งเตือนแมตช์',
        body:
          'หากคุณติดตามนักกีฬาหรือสโมสรเพื่อรับแจ้งเตือนเมื่อใกล้ถึงคิวแข่ง เซิร์ฟเวอร์ของเราจะเก็บที่อยู่สำหรับส่งการแจ้งเตือนของเบราว์เซอร์คุณ (ที่อยู่ที่เบราว์เซอร์สร้างขึ้นเพื่อให้การแจ้งเตือนมาถึงอุปกรณ์นี้) และรายชื่อนักกีฬากับสโมสรที่คุณติดตาม ข้อมูลนี้ใช้เพื่อส่งการแจ้งเตือนดังกล่าวเท่านั้น ไม่ได้ผูกกับชื่อหรือบัญชีใด ๆ เมื่อเลิกติดตามทั้งหมดข้อมูลจะถูกลบ และอุปกรณ์ที่ไม่ได้ใช้งานเกิน 60 วันจะถูกลบโดยอัตโนมัติ',
      },
```

Confirm the position in the Thai array by its headings first:

```bash
grep -n "heading:" lib/privacy.ts
```

Expected: eight headings per language before this change; the new one goes in as the seventh in each.

Also update the comment at the top of `lib/privacy.ts`: after the sentence ending "update the notice with it.", add: `Match alerts and what they store are lib/push/store.ts (STALE_DAYS).`

Run: `npx jest __tests__/Privacy.test.tsx`
Expected: PASS.

- [ ] **Step 3: Document the setup**

Append to `DEPLOY.md`:

```markdown
## Match alerts (web push)

Off until three settings are in `/root/app/.env.production`:

```bash
# once, on any machine with the repo:
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=<the public key printed above>
VAPID_PRIVATE_KEY=<the private key printed above>
VAPID_SUBJECT=mailto:<an address you read>
```

Then `pm2 reload bat-bracket`. The log line `[push] watcher started` confirms it; without the settings there is no such line and no follow button on the site.

- **Do not change the key pair** once people have followed someone: every existing subscription was made against the public key and would stop receiving alerts.
- State lives in `.cache/push/` (`subscriptions.json`, `sent.json`). Deleting `subscriptions.json` unfollows everyone.
- `/sw.js` must reach browsers uncached. `next.config.js` sends it with `no-store`; if a Cloudflare cache rule ever covers `*.js`, exclude `/sw.js`. Check with `curl -sI https://batmatch.app/sw.js | grep -i 'cache-control\|cf-cache-status'` (expect `no-store`, and `BYPASS` or `DYNAMIC`).
- Counts for the day are on `/bmstats` under "Match alerts". A tick that sent or failed anything logs `[push] tick sent=… failed=… gone=…`.
- The watcher asks the app's own `/api/matches` once a minute for each followed tournament in play, so it shares the schedule cache and adds at most one BAT request a minute per such tournament when nobody is viewing it.
```

- [ ] **Step 4: Commit**

```bash
git add lib/privacy.ts DEPLOY.md __tests__/Privacy.test.tsx
git commit -m "docs(alerts): privacy notice and deployment notes for match alerts"
```

---

### Task 11: Whole-feature verification

**Files:** none created. A fault found here is fixed in the file that owns it, with a test in that file's test.

- [ ] **Step 1: Full suite, types, lint, build**

Run: `npx jest --roots '<rootDir>/__tests__' && npx tsc --noEmit && npm run lint && npm run build`
Expected: every suite passes; `tsc` shows only the known `tournamentStats.test.ts:955` error; no lint errors; the build lists `/api/push/key`, `/api/push/follow`, `/api/push/unfollow`, `/api/push/state`.

- [ ] **Step 2: Feature off**

Start the dev server with no VAPID settings and open a BAT tournament.
Expected: no follow button in the player window, no "Follow club" in a club roster, the bell behaves as before, `curl -s -o /dev/null -w '%{http_code}' localhost:<port>/api/push/key` prints `404`, and the server log has no `[push] watcher started`.

- [ ] **Step 3: Feature on, locally**

```bash
npx web-push generate-vapid-keys
```

Put the three settings in `.env.local` (not committed), restart the dev server, and open the site in desktop Chrome at `http://localhost:<port>` (localhost counts as a secure origin for service workers).

1. Open a BAT tournament with matches today, tap a player, tap **Follow**. Allow the prompt. The button reads "Following". `.cache/push/subscriptions.json` holds one record with that player.
2. Open the bell: the player is under "Following". Unfollow there; the button in the player window returns to "Follow" and the record is gone.
3. Open the stats tab, open a club, tap **Follow club**: the warning shows; tap again; it reads "Following club". A member's player window reads "Following (club)".
4. Check the service worker: DevTools → Application → Service Workers shows `/sw.js` activated, and Cache Storage is empty.
5. Send a real push without waiting for a match. With a follow in place, run:

   ```bash
   node -e "
   const wp=require('web-push');const fs=require('fs');
   const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
   const r=JSON.parse(fs.readFileSync('.cache/push/subscriptions.json','utf8')).records[0];
   wp.sendNotification({endpoint:r.endpoint,keys:r.keys},JSON.stringify({title:'Up next',body:'Test Player vs Other · BS U15 R32 · Court 1',url:'/?tournament='+r.follows[0].tournamentId,tag:'test'}),{TTL:600,urgency:'high',vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}}).then(x=>console.log('status',x.statusCode)).catch(e=>console.log('failed',e.statusCode,e.body))"
   ```

   Expected: `status 201`, a system notification with that title and body, and clicking it focuses or opens the site on that tournament.
6. Leave the dev server running with a follow on a player whose match is within four places of the front of today's queue. Within about a minute the log shows `[push] tick sent=1 …` and the notification arrives. A second tick sends nothing.
7. Deny path: in a fresh browser profile, tap Follow and choose Block. The button explains that notifications are blocked, and `subscriptions.json` gains no record.

Check the browser console and the server log for errors after each step.

- [ ] **Step 4: Settle the remaining open points**

- **`web-push` on Node 20:** `ssh root@ezebat.lan "cd ~/app && node -e \"require('web-push'); console.log(process.version, 'ok')\""` after the first deploy that includes it. Expected: the version and `ok`.
- **Cloudflare and `/sw.js`:** after deploying, `curl -sI https://batmatch.app/sw.js | grep -i 'cache-control\|cf-cache-status'`. Expected: `no-store` and a status that is not `HIT`.
- **Club map freshness:** with a tournament in play, compare `ls -la .cache/clubs/<TOURNAMENT_ID>.json` on the server with the time now. If it is hours old, club follows still work from the in-memory map for any tournament someone has opened since the last restart; record what was seen in the commit message. No code change unless the file is missing for a tournament that is in play and has been viewed.
- **Phones (the user's own check):** on an Android phone in Chrome, and on an iPhone with BATMatch added to the home screen, follow a player and confirm an alert arrives with the app closed and the phone locked. On the iPhone in Safari without installing, confirm the button explains the home-screen step. Opened from a LINE chat, confirm the button explains opening in a browser.

- [ ] **Step 5: Commit anything Steps 2–4 changed**

```bash
git status --short
git add -A -- lib components app __tests__ public/sw.js DEPLOY.md
git commit -m "fix(alerts): corrections from checking match alerts in the running app"
```

Skip the commit when nothing changed. Never add `public/bwf-cache.json` or `.env.local`.
