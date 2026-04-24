# Live Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time score overlay to Match Schedule cards via the public `livescore.tournamentsoftware.com` SignalR 2.x hub, entirely browser-side.

**Architecture:** One self-contained SignalR client (`lib/live-score.ts`) speaking the classic SignalR 2.x protocol (negotiate → WebSocket → start → invoke → abort) over browser `fetch` + `WebSocket`. A React hook (`lib/useLiveScore.ts`) owns a single client instance, gated by "has at least one nowPlaying match". `MatchSchedule` consumes a `Map<courtKey, CourtLive>` and renders a red LIVE badge plus the in-progress set in red inside the existing score cell. No server changes, no new dependencies.

**Tech Stack:** TypeScript, Next.js 15 (app router, client components), React 19, Jest 30 + @testing-library/react, no SignalR library (hand-rolled 2.x client).

**Spec:** `docs/superpowers/specs/2026-04-24-live-score-design.md`

---

## File Structure

### New files

- **`lib/live-score.ts`** — one module, multiple exports:
  - `CourtLive` interface (data contract for UI)
  - `normalizeCourtName(name: string): string` — pure, cheap
  - `matchLiveCourt(entry: MatchEntry, map: Map<string, CourtLive>): CourtLive | null` — pure
  - `normalizePayload(raw: unknown): CourtLive[]` — pure
  - `LiveScoreClient` class (stateful, event-emitter) with `connect(id)`, `disconnect()`, `on(event, cb)`
- **`lib/useLiveScore.ts`** — React hook wrapping `LiveScoreClient`
- **`__tests__/live-score.test.ts`** — tests for pure helpers + client protocol
- **`__tests__/useLiveScore.test.tsx`** — hook lifecycle tests

### Modified files

- **`lib/i18n.ts`** — add `'live'` key ("LIVE" / "สด")
- **`components/MatchSchedule.tsx`** — accept `liveByCourt` prop, render LIVE badge + set-live span, suppress green pulse when live is present
- **`app/globals.css`** — add `.ms-live-badge`, `.set-live`, `.ms-board-set.live` styles for both themes
- **`app/page.tsx`** — compute gate, call `useLiveScore`, pass `liveByCourt` into `<MatchSchedule>`

---

## Task 1: CourtLive type and pure helpers (court normalization + matcher)

**Files:**
- Create: `lib/live-score.ts`
- Create: `__tests__/live-score.test.ts`

- [ ] **Step 1: Write failing tests for `normalizeCourtName` and `matchLiveCourt`**

Create `__tests__/live-score.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { normalizeCourtName, matchLiveCourt, type CourtLive } from '@/lib/live-score'
import type { MatchEntry } from '@/lib/types'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'A', playerId: '100' }],
    team2: [{ name: 'B', playerId: '200' }],
    winner: null, scores: [],
    court: 'Court - 3', walkover: false, retired: false,
    nowPlaying: true,
    ...over,
  }
}

function live(over: Partial<CourtLive> = {}): CourtLive {
  return {
    courtKey: 'court3',
    matchId: 42,
    playerIds: ['100', '200'],
    setScores: [],
    current: null,
    serving: 0,
    winner: 0,
    team1Points: 0, team2Points: 0,
    durationSec: 0,
    ...over,
  }
}

describe('normalizeCourtName', () => {
  it.each([
    ['Court - 3', 'court3'],
    ['Court 3', 'court3'],
    ['court3', 'court3'],
    ['3', '3'],
    ['  Court—3  ', 'court3'],
    ['Court 12', 'court12'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCourtName(input)).toBe(expected)
  })
})

describe('matchLiveCourt', () => {
  it('returns live when court key + ≥1 player ID match', () => {
    const map = new Map([['court3', live()]])
    expect(matchLiveCourt(entry(), map)).toEqual(live())
  })

  it('returns null when court matches but no player IDs overlap', () => {
    const map = new Map([['court3', live({ playerIds: ['999'] })]])
    expect(matchLiveCourt(entry(), map)).toBeNull()
  })

  it('returns null when court key does not match', () => {
    const map = new Map([['court4', live()]])
    expect(matchLiveCourt(entry(), map)).toBeNull()
  })

  it('returns null when nowPlaying is false', () => {
    const map = new Map([['court3', live()]])
    expect(matchLiveCourt(entry({ nowPlaying: false }), map)).toBeNull()
  })

  it('returns null when entry has empty court', () => {
    const map = new Map([['', live()]])
    expect(matchLiveCourt(entry({ court: '' }), map)).toBeNull()
  })

  it('matches when only one player in common (doubles substitution)', () => {
    const map = new Map([['court3', live({ playerIds: ['100', '888'] })]])
    const e = entry({
      team1: [{ name: 'A', playerId: '100' }, { name: 'C', playerId: '777' }],
      team2: [{ name: 'B', playerId: '200' }, { name: 'D', playerId: '999' }],
    })
    expect(matchLiveCourt(e, map)).toBeTruthy()
  })

  it('ignores empty playerId strings on match entry', () => {
    const map = new Map([['court3', live({ playerIds: ['', '200'] })]])
    const e = entry({
      team1: [{ name: 'A', playerId: '' }],
      team2: [{ name: 'B', playerId: '200' }],
    })
    expect(matchLiveCourt(e, map)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/live-score.test.ts -t 'normalizeCourtName|matchLiveCourt'`
Expected: FAIL — "Cannot find module '@/lib/live-score'".

- [ ] **Step 3: Create `lib/live-score.ts` with the types and pure helpers**

```ts
import type { MatchEntry } from './types'

export interface CourtLive {
  courtKey: string
  matchId: number
  playerIds: string[]
  setScores: { t1: number; t2: number; winner: 0 | 1 | 2 }[]
  current: { gameNo: number; setNo: number; t1: number; t2: number } | null
  serving: 0 | 1 | 2
  winner: 0 | 1 | 2
  team1Points: number
  team2Points: number
  durationSec: number
}

export function normalizeCourtName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function matchLiveCourt(
  m: MatchEntry,
  map: Map<string, CourtLive>,
): CourtLive | null {
  if (!m.nowPlaying || !m.court) return null
  const key = normalizeCourtName(m.court)
  if (!key) return null
  const live = map.get(key)
  if (!live) return null
  const schedIds = new Set(
    [...m.team1, ...m.team2].map((p) => p.playerId).filter(Boolean),
  )
  if (schedIds.size === 0) return null
  return live.playerIds.some((id) => id && schedIds.has(id)) ? live : null
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/live-score.test.ts -t 'normalizeCourtName|matchLiveCourt'`
Expected: PASS — all 13 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/live-score.ts __tests__/live-score.test.ts
git commit -m "Add CourtLive type and live-score matcher helpers"
```

---

## Task 2: Payload normalization (upstream SignalR JSON → CourtLive[])

**Files:**
- Modify: `lib/live-score.ts`
- Modify: `__tests__/live-score.test.ts`

- [ ] **Step 1: Add failing tests for `normalizePayload`**

Append to `__tests__/live-score.test.ts` (before the closing empty line):

```ts
import { normalizePayload } from '@/lib/live-score'

describe('normalizePayload', () => {
  const activeCourt = {
    CID: 1, N: 'Court 3', MID: 42,
    E: 'WS', R: 'QF',
    W: 0, D: 1800,
    T1: { ID: 10, N: 'Team A', F: 'THA', P: 1,
      P1ID: 100, P1N: 'Ratchanok', P1F: 'THA', P1ABR: 'INT',
      P2ID: 0,   P2N: '',          P2F: '',    P2ABR: '',
      P3ID: 0,   P3N: '',          P3F: '',    P3ABR: '' },
    T2: { ID: 20, N: 'Team B', F: 'THA', P: 0,
      P1ID: 200, P1N: 'Pornpawee', P1F: 'THA', P1ABR: 'CHO',
      P2ID: 0,   P2N: '',          P2F: '',    P2ABR: '',
      P3ID: 0,   P3N: '',          P3F: '',    P3ABR: '' },
    SCS: [{ W: 1, T1: 21, T2: 15 }],
    LSC: { GMNO: 2, STNO: 1, T1: 11, T2: 9 },
    SW: false, SW1: false, SW2: false, MST: true,
  }

  it('normalizes an active match with completed sets and a live game', () => {
    const [c] = normalizePayload({ S: 1, CS: [activeCourt] })
    expect(c).toMatchObject({
      courtKey: 'court3',
      matchId: 42,
      playerIds: ['100', '200'],
      setScores: [{ t1: 21, t2: 15, winner: 1 }],
      current: { gameNo: 2, setNo: 1, t1: 11, t2: 9 },
      winner: 0,
      team1Points: 1,
      team2Points: 0,
      durationSec: 1800,
    })
  })

  it('filters out courts where MID <= 0', () => {
    const idle = { ...activeCourt, MID: 0 }
    expect(normalizePayload({ S: 1, CS: [idle] })).toEqual([])
  })

  it('returns current=null between games (LSC null)', () => {
    const between = { ...activeCourt, LSC: null }
    const [c] = normalizePayload({ S: 1, CS: [between] })
    expect(c.current).toBeNull()
    expect(c.setScores.length).toBe(1)
  })

  it('includes P3ID for triples', () => {
    const triple = {
      ...activeCourt,
      T1: { ...activeCourt.T1, P2ID: 101, P3ID: 102 },
    }
    const [c] = normalizePayload({ S: 1, CS: [triple] })
    expect(c.playerIds).toEqual(expect.arrayContaining(['100', '101', '102', '200']))
  })

  it('handles empty CS array', () => {
    expect(normalizePayload({ S: 1, CS: [] })).toEqual([])
  })

  it('handles missing or non-object input safely', () => {
    expect(normalizePayload(null)).toEqual([])
    expect(normalizePayload({})).toEqual([])
    expect(normalizePayload({ S: 1 })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/live-score.test.ts -t normalizePayload`
Expected: FAIL — "normalizePayload is not a function".

- [ ] **Step 3: Add `normalizePayload` to `lib/live-score.ts`**

Append to `lib/live-score.ts`:

```ts
interface RawTeam {
  P?: number
  P1ID?: number; P2ID?: number; P3ID?: number
}
interface RawCourt {
  N?: string; MID?: number; D?: number; W?: 0 | 1 | 2
  T1?: RawTeam; T2?: RawTeam
  SCS?: { W: 0 | 1 | 2; T1: number; T2: number }[]
  LSC?: { GMNO: number; STNO: number; T1: number; T2: number } | null
}

function teamIds(t: RawTeam | undefined): string[] {
  if (!t) return []
  return [t.P1ID, t.P2ID, t.P3ID]
    .filter((id): id is number => typeof id === 'number' && id > 0)
    .map(String)
}

export function normalizePayload(raw: unknown): CourtLive[] {
  if (!raw || typeof raw !== 'object') return []
  const cs = (raw as { CS?: unknown }).CS
  if (!Array.isArray(cs)) return []
  const out: CourtLive[] = []
  for (const item of cs as RawCourt[]) {
    if (!item || typeof item !== 'object') continue
    const mid = typeof item.MID === 'number' ? item.MID : 0
    if (mid <= 0) continue
    const name = typeof item.N === 'string' ? item.N : ''
    const setScores = Array.isArray(item.SCS)
      ? item.SCS.map((s) => ({ t1: s.T1, t2: s.T2, winner: s.W }))
      : []
    const current = item.LSC
      ? { gameNo: item.LSC.GMNO, setNo: item.LSC.STNO, t1: item.LSC.T1, t2: item.LSC.T2 }
      : null
    out.push({
      courtKey: normalizeCourtName(name),
      matchId: mid,
      playerIds: [...teamIds(item.T1), ...teamIds(item.T2)],
      setScores,
      current,
      serving: 0,
      winner: (item.W ?? 0) as 0 | 1 | 2,
      team1Points: item.T1?.P ?? 0,
      team2Points: item.T2?.P ?? 0,
      durationSec: item.D ?? 0,
    })
  }
  return out
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/live-score.test.ts -t normalizePayload`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/live-score.ts __tests__/live-score.test.ts
git commit -m "Add live-score payload normalizer"
```

---

## Task 3: SignalR 2.x client — negotiate + WebSocket handshake

**Files:**
- Modify: `lib/live-score.ts`
- Modify: `__tests__/live-score.test.ts`

- [ ] **Step 1: Add a WebSocket mock helper and failing handshake tests**

Append to `__tests__/live-score.test.ts`:

```ts
import { LiveScoreClient } from '@/lib/live-score'

class MockSocket {
  static last: MockSocket | null = null
  url: string
  readyState = 0
  sent: string[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
    MockSocket.last = this
  }
  send(data: string) { this.sent.push(data) }
  close() {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  }
  simulateOpen() { this.readyState = 1; this.onopen?.(new Event('open')) }
  simulateMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }
  simulateClose() { this.readyState = 3; this.onclose?.(new CloseEvent('close')) }
}

function installMocks() {
  ;(global as unknown as { WebSocket: typeof MockSocket }).WebSocket = MockSocket
  const fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  return { fetchMock }
}

function mockJsonOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response
}

describe('LiveScoreClient — negotiate + connect', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    MockSocket.last = null
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls negotiate with clientProtocol, connectionData, VClientID', async () => {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue(
      mockJsonOk({ ConnectionToken: 'TOKEN_XYZ', ProtocolVersion: '1.5' }),
    )
    const c = new LiveScoreClient()
    c.connect('GUID-1')
    await Promise.resolve()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/signalr/negotiate')
    expect(url).toContain('clientProtocol=1.5')
    expect(url).toContain(encodeURIComponent('[{"name":"scoreboardHub"}]'))
    expect(url).toContain('VClientID=')
  })

  it('opens the WebSocket with the returned connection token after negotiate', async () => {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue(
      mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }),
    )
    const c = new LiveScoreClient()
    c.connect('GUID-2')
    await Promise.resolve(); await Promise.resolve()
    expect(MockSocket.last).not.toBeNull()
    expect(MockSocket.last!.url).toContain('wss://livescore.tournamentsoftware.com/signalr/connect')
    expect(MockSocket.last!.url).toContain(`connectionToken=${encodeURIComponent('TOK')}`)
    expect(MockSocket.last!.url).toContain('transport=webSockets')
  })

  it('calls start and sends joinScoreboardNew after socket opens', async () => {
    const { fetchMock } = installMocks()
    fetchMock
      .mockResolvedValueOnce(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' })) // negotiate
      .mockResolvedValueOnce(mockJsonOk({ Response: 'started' }))                             // start
    const c = new LiveScoreClient()
    c.connect('GUID-3')
    await Promise.resolve(); await Promise.resolve()
    MockSocket.last!.simulateOpen()
    await Promise.resolve(); await Promise.resolve()
    const startUrl = fetchMock.mock.calls[1][0] as string
    expect(startUrl).toContain('/signalr/start')
    expect(MockSocket.last!.sent[0]).toBe(JSON.stringify({
      H: 'scoreboardHub', M: 'joinScoreboardNew', A: ['GUID-3'], I: 0,
    }))
  })

  it('transitions directly to disabled on negotiate 4xx (e.g. rotated VClientID)', async () => {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}), text: async () => '' } as Response)
    const c = new LiveScoreClient()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    c.connect('GUID-4')
    await Promise.resolve(); await Promise.resolve()
    expect(states).toContain('disabled')
    expect(MockSocket.last).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/live-score.test.ts -t 'negotiate'`
Expected: FAIL — "LiveScoreClient is not a constructor".

- [ ] **Step 3: Implement the `LiveScoreClient` class — handshake only**

Append to `lib/live-score.ts`:

```ts
const HUB_HOST = 'https://livescore.tournamentsoftware.com'
const WS_HOST  = 'wss://livescore.tournamentsoftware.com'
const HUB_NAME = 'scoreboardHub'
const CLIENT_PROTOCOL = '1.5'
const CONNECTION_DATA = JSON.stringify([{ name: HUB_NAME }])
const VCLIENT_ID = 'NYrnY8LtCyasfDWQHf9KFBsdfgCwjpvWQ4JHTNtJg'

type State =
  | 'idle' | 'negotiating' | 'subscribed' | 'active'
  | 'reconnecting' | 'disabled'

type Events = {
  scoreboard: (courts: CourtLive[]) => void
  state: (state: State) => void
}

export class LiveScoreClient {
  private listeners: { [K in keyof Events]: Events[K][] } = { scoreboard: [], state: [] }
  private tournamentId: string | null = null
  private state: State = 'idle'
  private ws: WebSocket | null = null
  private connectionToken: string | null = null

  on<K extends keyof Events>(ev: K, cb: Events[K]) {
    this.listeners[ev].push(cb)
  }

  connect(tournamentId: string) {
    this.tournamentId = tournamentId
    this.setState('negotiating')
    void this.doNegotiate()
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    this.setState('idle')
  }

  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    for (const cb of this.listeners[ev]) (cb as (...a: unknown[]) => void)(...args)
  }

  private setState(s: State) {
    this.state = s
    this.emit('state', s)
  }

  private async doNegotiate() {
    const qs = new URLSearchParams({
      clientProtocol: CLIENT_PROTOCOL,
      connectionData: CONNECTION_DATA,
      VClientID: VCLIENT_ID,
      _: String(Date.now()),
    })
    const url = `${HUB_HOST}/signalr/negotiate?${qs}`
    let res: Response
    try {
      res = await fetch(url)
    } catch {
      this.setState('reconnecting')
      return
    }
    if (res.status >= 400 && res.status < 500) {
      this.setState('disabled')
      return
    }
    if (!res.ok) {
      this.setState('reconnecting')
      return
    }
    const data = await res.json() as { ConnectionToken?: string }
    if (!data.ConnectionToken) {
      this.setState('disabled')
      return
    }
    this.connectionToken = data.ConnectionToken
    this.openSocket()
  }

  private openSocket() {
    const qs = new URLSearchParams({
      transport: 'webSockets',
      clientProtocol: CLIENT_PROTOCOL,
      connectionToken: this.connectionToken!,
      connectionData: CONNECTION_DATA,
      VClientID: VCLIENT_ID,
      tid: String(Math.floor(Math.random() * 10)),
    })
    const url = `${WS_HOST}/signalr/connect?${qs}`
    this.ws = new WebSocket(url)
    this.ws.onopen = () => void this.onWsOpen()
    this.ws.onmessage = (e) => this.onWsMessage(e)
    this.ws.onclose = () => this.onWsClose()
    this.ws.onerror = () => { /* surfaced via onclose */ }
  }

  private async onWsOpen() {
    const qs = new URLSearchParams({
      transport: 'webSockets',
      clientProtocol: CLIENT_PROTOCOL,
      connectionToken: this.connectionToken!,
      connectionData: CONNECTION_DATA,
      VClientID: VCLIENT_ID,
      _: String(Date.now()),
    })
    try { await fetch(`${HUB_HOST}/signalr/start?${qs}`) } catch { /* proceed */ }
    this.ws?.send(JSON.stringify({
      H: HUB_NAME, M: 'joinScoreboardNew', A: [this.tournamentId], I: 0,
    }))
    this.setState('subscribed')
  }

  private onWsMessage(_e: MessageEvent) { /* Task 4 */ }
  private onWsClose() { /* Task 5 */ }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/live-score.test.ts -t 'negotiate'`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/live-score.ts __tests__/live-score.test.ts
git commit -m "Add SignalR 2.x handshake for live-score client"
```

---

## Task 4: SignalR client — receive scoreboard + heartbeat

**Files:**
- Modify: `lib/live-score.ts`
- Modify: `__tests__/live-score.test.ts`

- [ ] **Step 1: Add failing tests for scoreboard + heartbeat delivery**

Append to `__tests__/live-score.test.ts`:

```ts
describe('LiveScoreClient — messages', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    MockSocket.last = null
  })
  afterEach(() => jest.useRealTimers())

  async function subscribedClient() {
    const { fetchMock } = installMocks()
    fetchMock
      .mockResolvedValueOnce(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }))
      .mockResolvedValue(mockJsonOk({ Response: 'started' }))
    const c = new LiveScoreClient()
    c.connect('GUID-M')
    await Promise.resolve(); await Promise.resolve()
    MockSocket.last!.simulateOpen()
    await Promise.resolve(); await Promise.resolve()
    return c
  }

  it('fires "scoreboard" with normalized courts when sendScoreboard arrives', async () => {
    const c = await subscribedClient()
    const heard: CourtLive[][] = []
    c.on('scoreboard', (cs) => heard.push(cs))
    const payload = {
      S: 1,
      CS: [{
        CID: 1, N: 'Court 1', MID: 7, E: 'WS', R: 'SF', W: 0, D: 120,
        T1: { ID: 1, N: 'T1', F: 'THA', P: 1, P1ID: 11, P1N: 'x', P1F: '', P1ABR: '', P2ID: 0, P2N: '', P2F: '', P2ABR: '', P3ID: 0, P3N: '', P3F: '', P3ABR: '' },
        T2: { ID: 2, N: 'T2', F: 'THA', P: 0, P1ID: 22, P1N: 'y', P1F: '', P1ABR: '', P2ID: 0, P2N: '', P2F: '', P2ABR: '', P3ID: 0, P3N: '', P3F: '', P3ABR: '' },
        SCS: [], LSC: { GMNO: 1, STNO: 1, T1: 5, T2: 3 },
        SW: false, SW1: false, SW2: false, MST: false,
      }],
    }
    MockSocket.last!.simulateMessage({
      C: 'x', M: [{ H: 'scoreboardHub', M: 'sendScoreboard', A: [payload] }],
    })
    expect(heard.length).toBe(1)
    expect(heard[0][0].courtKey).toBe('court1')
    expect(heard[0][0].current).toEqual({ gameNo: 1, setNo: 1, t1: 5, t2: 3 })
  })

  it('transitions subscribed → active after first non-empty scoreboard', async () => {
    const c = await subscribedClient()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    MockSocket.last!.simulateMessage({
      C: 'x', M: [{ H: 'scoreboardHub', M: 'sendScoreboard', A: [{ S: 1, CS: [{ MID: 1, N: 'C1', T1: {}, T2: {}, SCS: [], LSC: null, D: 0, W: 0 }] }] }],
    })
    expect(states).toContain('active')
  })

  it('handles heartbeat message without emitting scoreboard', async () => {
    const c = await subscribedClient()
    const heard: CourtLive[][] = []
    c.on('scoreboard', (cs) => heard.push(cs))
    MockSocket.last!.simulateMessage({
      C: 'x', M: [{ H: 'scoreboardHub', M: 'heartbeat', A: [] }],
    })
    expect(heard.length).toBe(0)
  })

  it('ignores keep-alive frames (empty M array)', async () => {
    const c = await subscribedClient()
    const heard: CourtLive[][] = []
    c.on('scoreboard', (cs) => heard.push(cs))
    MockSocket.last!.simulateMessage({ C: 'x', M: [] })
    MockSocket.last!.simulateMessage({})
    expect(heard.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/live-score.test.ts -t 'messages'`
Expected: FAIL — scoreboard events never fire.

- [ ] **Step 3: Flesh out `onWsMessage` and heartbeat tracking**

In `lib/live-score.ts`, add a private `lastHeartbeat` field, replace the `onWsMessage` stub, and update `setState` call after scoreboard delivery:

Add to the `LiveScoreClient` class fields (top of class body, under `connectionToken`):

```ts
  private lastHeartbeat = 0
```

Replace the body of `onWsMessage`:

```ts
  private onWsMessage(e: MessageEvent) {
    let msg: unknown
    try { msg = JSON.parse(e.data as string) } catch { return }
    if (!msg || typeof msg !== 'object') return
    const invocations = (msg as { M?: unknown }).M
    if (!Array.isArray(invocations)) return
    for (const inv of invocations as Array<{ H?: string; M?: string; A?: unknown[] }>) {
      if (inv.M === 'heartbeat') {
        this.lastHeartbeat = Date.now()
        continue
      }
      if (inv.H === HUB_NAME && inv.M === 'sendScoreboard') {
        const payload = Array.isArray(inv.A) ? inv.A[0] : null
        const courts = normalizePayload(payload)
        if (courts.length > 0 && this.state !== 'active') this.setState('active')
        this.emit('scoreboard', courts)
      }
    }
  }
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/live-score.test.ts -t 'messages'`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/live-score.ts __tests__/live-score.test.ts
git commit -m "Handle sendScoreboard and heartbeat in live-score client"
```

---

## Task 5: SignalR client — reconnect, soft-disable, abort

**Files:**
- Modify: `lib/live-score.ts`
- Modify: `__tests__/live-score.test.ts`

- [ ] **Step 1: Add failing tests for reconnect, disable, and abort**

Append to `__tests__/live-score.test.ts`:

```ts
describe('LiveScoreClient — reconnect + disable', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    MockSocket.last = null
  })
  afterEach(() => jest.useRealTimers())

  async function runToSubscribed() {
    const { fetchMock } = installMocks()
    fetchMock
      .mockResolvedValue(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }))
    const c = new LiveScoreClient()
    c.connect('GUID-R')
    await Promise.resolve(); await Promise.resolve()
    MockSocket.last!.simulateOpen()
    await Promise.resolve(); await Promise.resolve()
    return c
  }

  it('soft-disables after 8s with empty CS (subscribed but never active)', async () => {
    const c = await runToSubscribed()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    jest.advanceTimersByTime(8100)
    await Promise.resolve()
    expect(states).toContain('disabled')
  })

  it('does not soft-disable if a non-empty CS arrives in time', async () => {
    const c = await runToSubscribed()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    MockSocket.last!.simulateMessage({
      C: 'x', M: [{ H: 'scoreboardHub', M: 'sendScoreboard', A: [{ S: 1, CS: [{ MID: 1, N: 'C1', T1: {}, T2: {}, SCS: [], LSC: null, D: 0, W: 0 }] }] }],
    })
    jest.advanceTimersByTime(9000)
    await Promise.resolve()
    expect(states).not.toContain('disabled')
  })

  it('reconnects with back-off after socket close', async () => {
    const c = await runToSubscribed()
    MockSocket.last!.simulateClose()
    // First back-off = 1s
    jest.advanceTimersByTime(1100)
    await Promise.resolve()
    // A new negotiate + new socket should be created
    expect(MockSocket.last).not.toBeNull()
  })

  it('goes to disabled after 5 failed reconnect attempts', async () => {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }))
    const c = new LiveScoreClient()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    c.connect('GUID-X')
    await Promise.resolve(); await Promise.resolve()
    // Force 6 close events with enough time for each back-off
    const backoffs = [1000, 2000, 4000, 8000, 15000, 15000]
    for (const ms of backoffs) {
      if (MockSocket.last) {
        MockSocket.last.simulateOpen()
        await Promise.resolve(); await Promise.resolve()
        MockSocket.last.simulateClose()
      }
      jest.advanceTimersByTime(ms + 100)
      await Promise.resolve(); await Promise.resolve()
    }
    expect(states).toContain('disabled')
  })

  it('disconnect() closes the socket and returns to idle', async () => {
    const c = await runToSubscribed()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    c.disconnect()
    expect(states).toContain('idle')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/live-score.test.ts -t 'reconnect'`
Expected: FAIL — reconnect/disable logic not implemented.

- [ ] **Step 3: Implement reconnect, soft-disable, and onWsClose**

Update `lib/live-score.ts`:

Add private fields under `lastHeartbeat`:

```ts
  private subscribeTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private sawCourts = false
```

Extend `setState` to start/stop the subscribe-watchdog:

```ts
  private setState(s: State) {
    this.state = s
    this.emit('state', s)
    if (s === 'subscribed') {
      this.clearSubscribeTimer()
      this.subscribeTimer = setTimeout(() => {
        if (this.state === 'subscribed' && !this.sawCourts) {
          this.setState('disabled')
          this.closeSocket()
        }
      }, 8000)
    }
    if (s === 'active' || s === 'disabled' || s === 'idle' || s === 'reconnecting') {
      this.clearSubscribeTimer()
    }
  }

  private clearSubscribeTimer() {
    if (this.subscribeTimer) { clearTimeout(this.subscribeTimer); this.subscribeTimer = null }
  }
```

Update `onWsMessage`'s scoreboard branch to flip `sawCourts`:

Replace the scoreboard branch with:

```ts
      if (inv.H === HUB_NAME && inv.M === 'sendScoreboard') {
        const payload = Array.isArray(inv.A) ? inv.A[0] : null
        const courts = normalizePayload(payload)
        if (courts.length > 0) {
          this.sawCourts = true
          if (this.state !== 'active') this.setState('active')
        }
        this.emit('scoreboard', courts)
      }
```

Replace the stub `onWsClose` and add helpers:

```ts
  private onWsClose() {
    this.ws = null
    if (this.state === 'disabled' || this.state === 'idle') return
    if (this.reconnectAttempts >= 5) {
      this.setState('disabled')
      return
    }
    const delays = [1000, 2000, 4000, 8000, 15000]
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)]
    this.reconnectAttempts++
    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      if (!this.tournamentId) return
      this.setState('negotiating')
      void this.doNegotiate()
    }, delay)
  }

  private closeSocket() {
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
  }
```

Replace the existing `disconnect` method:

```ts
  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.clearSubscribeTimer()
    this.tournamentId = null
    this.sawCourts = false
    this.reconnectAttempts = 0
    this.closeSocket()
    this.setState('idle')
  }
```

Reset `reconnectAttempts` on successful `active`:

In `setState`, inside the `if (s === 'active' …)` branch:

```ts
    if (s === 'active') {
      this.reconnectAttempts = 0
    }
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/live-score.test.ts`
Expected: PASS — all suites green (≈24 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-score.ts __tests__/live-score.test.ts
git commit -m "Add reconnect, soft-disable, and abort to live-score client"
```

---

## Task 6: `useLiveScore` React hook

**Files:**
- Create: `lib/useLiveScore.ts`
- Create: `__tests__/useLiveScore.test.tsx`

- [ ] **Step 1: Write failing tests for the hook**

Create `__tests__/useLiveScore.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useLiveScore } from '@/lib/useLiveScore'
import type { CourtLive } from '@/lib/live-score'

type ClientMock = {
  connect: jest.Mock
  disconnect: jest.Mock
  on: jest.Mock
  emit: (ev: 'scoreboard' | 'state', arg: unknown) => void
}

jest.mock('@/lib/live-score', () => {
  const actual = jest.requireActual('@/lib/live-score')
  const listeners: Record<string, Array<(a: unknown) => void>> = {}
  const client = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((ev: string, cb: (a: unknown) => void) => {
      ;(listeners[ev] ||= []).push(cb)
    }),
    emit: (ev: string, arg: unknown) => (listeners[ev] || []).forEach((cb) => cb(arg)),
  }
  return {
    ...actual,
    LiveScoreClient: jest.fn(() => client),
    __client: client,
  }
})

import * as liveMod from '@/lib/live-score'
const mocked = liveMod as unknown as { __client: ClientMock }

describe('useLiveScore', () => {
  beforeEach(() => {
    mocked.__client.connect.mockClear()
    mocked.__client.disconnect.mockClear()
  })

  it('does not connect when tournamentId is null', () => {
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: null as string | null, gate: true } })
    expect(mocked.__client.connect).not.toHaveBeenCalled()
  })

  it('does not connect when gate is closed', () => {
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: false } })
    expect(mocked.__client.connect).not.toHaveBeenCalled()
  })

  it('connects when both id and gate are truthy', () => {
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    expect(mocked.__client.connect).toHaveBeenCalledWith('T1')
  })

  it('disconnects when gate flips closed', () => {
    const { rerender } = renderHook(
      ({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } },
    )
    rerender({ id: 'T1', gate: false })
    expect(mocked.__client.disconnect).toHaveBeenCalled()
  })

  it('updates map when scoreboard event fires', () => {
    const { result } = renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    const sample: CourtLive = {
      courtKey: 'court1', matchId: 5, playerIds: ['10'],
      setScores: [], current: null, serving: 0, winner: 0,
      team1Points: 0, team2Points: 0, durationSec: 0,
    }
    act(() => { mocked.__client.emit('scoreboard', [sample]) })
    expect(result.current.get('court1')).toEqual(sample)
  })

  it('replaces the map wholesale on each scoreboard push', () => {
    const { result } = renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    const a: CourtLive = { courtKey: 'court1', matchId: 1, playerIds: [], setScores: [], current: null, serving: 0, winner: 0, team1Points: 0, team2Points: 0, durationSec: 0 }
    const b: CourtLive = { ...a, courtKey: 'court2', matchId: 2 }
    act(() => { mocked.__client.emit('scoreboard', [a]) })
    act(() => { mocked.__client.emit('scoreboard', [b]) })
    expect(result.current.has('court1')).toBe(false)
    expect(result.current.has('court2')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/useLiveScore.test.tsx`
Expected: FAIL — "Cannot find module '@/lib/useLiveScore'".

- [ ] **Step 3: Implement `lib/useLiveScore.ts`**

```ts
'use client'

import { useEffect, useRef, useState } from 'react'
import { LiveScoreClient, type CourtLive } from './live-score'

export function useLiveScore(
  tournamentId: string | null,
  gateOpen: boolean,
): Map<string, CourtLive> {
  const [map, setMap] = useState<Map<string, CourtLive>>(() => new Map())
  const clientRef = useRef<LiveScoreClient | null>(null)

  useEffect(() => {
    if (!tournamentId || !gateOpen) {
      clientRef.current?.disconnect()
      clientRef.current = null
      setMap(new Map())
      return
    }
    const client = new LiveScoreClient()
    clientRef.current = client
    client.on('scoreboard', (courts) => {
      const next = new Map<string, CourtLive>()
      for (const c of courts) next.set(c.courtKey, c)
      setMap(next)
    })
    client.connect(tournamentId)
    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [tournamentId, gateOpen])

  return map
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/useLiveScore.test.tsx`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/useLiveScore.ts __tests__/useLiveScore.test.tsx
git commit -m "Add useLiveScore React hook"
```

---

## Task 7: MatchSchedule — render LIVE badge and in-progress set in red

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Modify: `lib/i18n.ts`
- Create: `__tests__/MatchSchedule.live.test.tsx`

- [ ] **Step 1: Add i18n key `live`**

Edit `lib/i18n.ts`:

In the `TKey` union (around line 68–125), add `'live'` after `'retired'`:

```ts
  | 'retired'
  | 'live'
  | 'nowPlaying'
```

In `dict.en`, add under `retired: 'Ret.'`:

```ts
    live: 'LIVE',
```

In `dict.th`, add under `retired: 'ถอน'`:

```ts
    live: 'สด',
```

- [ ] **Step 2: Write failing component tests**

Create `__tests__/MatchSchedule.live.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'
import type { CourtLive } from '@/lib/live-score'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [{ t1: 21, t2: 15 }],
    court: 'Court - 3', walkover: false, retired: false,
    nowPlaying: true,
    ...over,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup => ({ type: 'time', time: '10:00', matches: [m] })

const live = (over: Partial<CourtLive> = {}): CourtLive => ({
  courtKey: 'court3', matchId: 42, playerIds: ['100', '200'],
  setScores: [{ t1: 21, t2: 15, winner: 1 }],
  current: { gameNo: 2, setNo: 1, t1: 11, t2: 9 },
  serving: 0, winner: 0,
  team1Points: 0, team2Points: 0, durationSec: 0,
  ...over,
})

function renderWith(m: MatchEntry, liveByCourt?: Map<string, CourtLive>) {
  return render(
    <LanguageProvider>
      <MatchSchedule
        groups={[group(m)]}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery=""
        liveByCourt={liveByCourt}
      />
    </LanguageProvider>,
  )
}

describe('MatchSchedule — live overlay', () => {
  it('renders LIVE badge and set-live span when a live record matches', () => {
    renderWith(entry(), new Map([['court3', live()]]))
    expect(screen.getByText('LIVE')).toHaveClass('ms-live-badge')
    const liveSet = screen.getByText('11-9')
    expect(liveSet).toHaveClass('set-live')
  })

  it('suppresses the green ms-now-playing pulse when a live record matches', () => {
    const { container } = renderWith(entry(), new Map([['court3', live()]]))
    expect(container.querySelector('.ms-now-playing')).toBeNull()
  })

  it('keeps the green pulse when no live record matches', () => {
    const { container } = renderWith(entry(), new Map())
    expect(container.querySelector('.ms-now-playing')).not.toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
  })

  it('shows LIVE badge but no set-live span between games (current=null)', () => {
    renderWith(entry(), new Map([['court3', live({ current: null })]]))
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(document.querySelector('.set-live')).toBeNull()
  })

  it('does not render LIVE when the match is nowPlaying but player IDs do not overlap', () => {
    const unrelated = live({ playerIds: ['555'] })
    renderWith(entry(), new Map([['court3', unrelated]]))
    expect(screen.queryByText('LIVE')).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `npx jest __tests__/MatchSchedule.live.test.tsx`
Expected: FAIL — "MatchSchedule does not accept liveByCourt" / "LIVE not found".

- [ ] **Step 4: Modify `components/MatchSchedule.tsx`**

Update the imports at the top (after the existing imports):

```tsx
import type { MatchScheduleGroup, MatchDay, MatchEntry } from '@/lib/types'
import { matchLiveCourt, type CourtLive } from '@/lib/live-score'
import { useLanguage } from '@/lib/LanguageContext'
```

Extend `Props`:

```tsx
interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  onEventClick?: (drawNum: string, round: string) => void
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string) => void
  liveByCourt?: Map<string, CourtLive>
}
```

Update the component signature:

```tsx
export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt }: Props) {
```

Replace the existing `scoreStr` helper with a version that consumes `CourtLive`:

```ts
function scoreStr(
  entry: MatchEntry,
  tr: { walkover: string; vsMatch: string; retired: string },
  live: CourtLive | null,
): { done: string; liveText: string | null } {
  if (entry.walkover) return { done: tr.walkover, liveText: null }
  const baseSets = live?.setScores?.length
    ? live.setScores.map((s) => `${s.t1}-${s.t2}`)
    : entry.scores.map((s) => `${s.t1}-${s.t2}`)
  const done = baseSets.length === 0 && !live
    ? tr.vsMatch
    : entry.retired
      ? `${baseSets.join(', ')} ${tr.retired}`
      : baseSets.join(', ')
  const liveText = live?.current ? `${live.current.t1}-${live.current.t2}` : null
  return { done, liveText }
}
```

Inside `renderMatch`, replace the existing single-line score usage. Add `live` lookup at the top of the function body:

```tsx
  const renderMatch = (m: MatchEntry, mi: number, showCourt: boolean) => {
    const finalMedal = isFinalRound(m.round)
    const live = liveByCourt ? matchLiveCourt(m, liveByCourt) : null
    const isLive = live !== null
    const { done: doneScore, liveText } = scoreStr(m, scoreTr, live)
    const medal = (team: 1 | 2) =>
      finalMedal && m.winner === team ? <span className="ms-medal" aria-label="winner">🥇</span> : null
    return (
```

Replace the desktop meta section — find the `<span className="ms-event"…>` line and add a LIVE badge before it. Also guard `ms-now-playing` with `!isLive`:

```tsx
      <div className="ms-meta">
        {isLive && <span className="ms-live-badge">{t('live')}</span>}
        <span
          className={`ms-event${onEventClick && m.drawNum ? ' ms-event--link' : ''}`}
          onClick={onEventClick && m.drawNum ? () => onEventClick(m.drawNum, m.round) : undefined}
        >{m.draw}</span>
        <span className="ms-round">{longRound(m.round)}</span>
        {showCourt && m.court && <span className="ms-court">{m.court}</span>}
        {m.sequenceLabel && <span className="ms-seq">{m.sequenceLabel}</span>}
        {m.nowPlaying && !isLive && <span className="ms-now-playing" title={t('nowPlaying')} />}
        {m.h2hUrl && onH2HClick && (
          <button
            className="ms-h2h-inline"
            onClick={() => onH2HClick(m.h2hUrl!)}
            title={t('h2hButton')}
          >{t('h2hButton')}</button>
        )}
      </div>
```

Replace the desktop `.ms-score` cell:

```tsx
      <div className="ms-score ms-d">
        {doneScore && <span>{doneScore}</span>}
        {liveText && doneScore && <span>, </span>}
        {liveText && <span className="set-live">{liveText}</span>}
      </div>
```

For the mobile scoreboard (`ms-board-row`), update the per-set cells to mark the last cell as `.live` when `liveText` exists. Find the two `ms-board-row` blocks. Replace the set rendering in each `ms-board-row` with:

```tsx
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 1 ? t('walkover') : ''}</span>
            : (
              <>
                {(live?.setScores?.length
                  ? live.setScores.map((s) => s.t1)
                  : m.scores.map((s) => s.t1)
                ).map((v, i) => <span key={i} className="ms-board-set">{v}</span>)}
                {live?.current && <span className="ms-board-set live">{live.current.t1}</span>}
                {m.retired && m.winner === 1 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
```

And the corresponding `ms-board-row` for team2 uses `s.t2` and `live.current.t2`. (Same structure — just swap `t1` → `t2` and `winner === 1` → `winner === 2`.)

- [ ] **Step 5: Run tests — verify they pass**

Run: `npx jest __tests__/MatchSchedule.live.test.tsx`
Expected: PASS — all 5 cases green.

Run the full suite to confirm no regression:

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/MatchSchedule.tsx lib/i18n.ts __tests__/MatchSchedule.live.test.tsx
git commit -m "Render live-score overlay in MatchSchedule"
```

---

## Task 8: CSS for LIVE badge and in-progress score

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add styles for `.ms-live-badge`, `.set-live`, `.ms-board-set.live`**

Append to `app/globals.css` (after the existing `.ms-now-playing` block around line 1148):

```css
.ms-live-badge {
  display: inline-block;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 6px;
  flex-shrink: 0;
}
html.dark .ms-live-badge {
  background: #ff7b72;
  color: #0d1117;
}

.ms-score .set-live {
  color: #ef4444;
  font-weight: 700;
}
html.dark .ms-score .set-live {
  color: #ff7b72;
}

.ms-board-set.live {
  color: #ef4444;
}
html.dark .ms-board-set.live {
  color: #ff7b72;
}
```

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`
Open: `http://localhost:3000`

Manually verify: open DevTools → Elements panel, confirm the new classes are recognized. (No live match is needed at this step; the selectors are inert without the DOM.)

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "Style LIVE badge and in-progress set in red"
```

---

## Task 9: Wire live-score into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the hook call and gate computation**

Edit `app/page.tsx`:

Add this import alongside the other `@/lib/*` imports near the top:

```tsx
import { useLiveScore } from '@/lib/useLiveScore'
```

Inside the `Home` component body, just after the existing `useState` and `useRef` block and before the first `useEffect`, add:

```tsx
  const liveGate = matchGroups.some((g) => g.matches.some((m) => m.nowPlaying))
  const liveByCourt = useLiveScore(selectedTournament || null, liveGate)
```

- [ ] **Step 2: Pass the map into `MatchSchedule`**

Find the `<MatchSchedule … />` element (around line 557) and add the prop:

```tsx
        <MatchSchedule
          groups={matchGroups}
          days={matchDays}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={handlePlayerClick}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
        />
```

- [ ] **Step 3: Lint and type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx next lint`
Expected: no new warnings introduced by the new files.

- [ ] **Step 4: Run full test suite**

Run: `npx jest`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "Wire useLiveScore into page.tsx with nowPlaying gate"
```

---

## Task 10: Manual smoke test against a live tournament

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate and select a live-enabled tournament**

Open `http://localhost:3000` in a browser during an active session. Select tournament `D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC` (or any tournament currently in play on `bat.tournamentsoftware.com`).

- [ ] **Step 3: Verify live behavior**

Open DevTools → Network → WS tab. Confirm:

1. A WebSocket opens to `wss://livescore.tournamentsoftware.com/signalr/connect?…` only after the schedule returns matches with `nowPlaying:true`.
2. Matches reported as in-progress show the red `LIVE` badge in the meta cell and a red in-progress score in the score cell.
3. Switching to a different tournament cleanly closes the WebSocket (row marked `(closed)` in the WS tab).
4. Selecting a tournament with no live feed does not keep retrying — after 8 s the WS closes and does not reopen on subsequent day-switches.

- [ ] **Step 4: If any expectation fails, diagnose via DevTools + terminal logs**

Common issues and remedies (do **not** change the design — file an issue and pause):

- **Negotiate returns 4xx for all tournaments:** upstream rotated `VCLIENT_ID`. Capture the new value from `view-source:https://bat.tournamentsoftware.com/visual-livescore/<GUID>` and update the constant in `lib/live-score.ts`.
- **WS opens but no `sendScoreboard` ever arrives:** verify the `joinScoreboardNew` frame was sent with the correct GUID (check `ws.sent[0]` in the WS frames panel).

- [ ] **Step 5: Stop the dev server and summarize**

Stop the dev server. Report completion in the task comments / PR description, noting the timestamp of the smoke test and any upstream data observed.

---

## Self-Review

**Spec coverage check:**

- §1 user-facing behavior: LIVE badge before event code → Task 7 (meta cell). In-progress game in red in score cell → Task 7 (`set-live`). Green pulse suppression when live present → Task 7 (meta guard). No new controls → enforced by having no toggle UI.
- §2 architecture: one SignalR client module → Task 1-5. React hook → Task 6. Gate on nowPlaying → Task 9. Unsupported-set soft-disable → Task 5 (8s watchdog → `disabled`).
- §3 payload normalization → Task 2. `current` null between games → Task 2. Triples → Task 2.
- §4 matcher court+player → Task 1 (`matchLiveCourt`).
- §5 connection lifecycle (negotiating → subscribed → active → reconnecting → disabled): Tasks 3 (negotiate handshake, 4xx→disabled), 4 (active transition), 5 (reconnect, disabled after 5 attempts, soft-disable). Visibility handling for > 60s hidden is *not* covered by an automated test but is mentioned in the spec — add a manual verification item, see Task 10. **Gap:** visibility handling is specified in §5 but not implemented. Fix: add to Task 6.
- §6 affected files: all listed files covered (`lib/live-score.ts`, `lib/useLiveScore.ts`, tests, `lib/types.ts`, `app/page.tsx`, `components/MatchSchedule.tsx`, `app/globals.css`, `lib/i18n.ts`). `lib/types.ts` mentioned in spec §6 as exporting `CourtLive` — the plan instead exports `CourtLive` from `lib/live-score.ts` and imports it where needed. This is equivalent (and avoids circular imports); the spec's "export from types.ts" was incidental. **Decision:** keep `CourtLive` in `lib/live-score.ts`.
- §7 testing: all listed unit cases are present in Tasks 1-7. Integration manual test → Task 10.
- §8 out of scope items are not present in the plan.

**Placeholder scan:** no `TBD` / `TODO` / `fill in`. All code blocks are complete.

**Type / name consistency:** `CourtLive`, `LiveScoreClient`, `useLiveScore`, `matchLiveCourt`, `normalizeCourtName`, `normalizePayload`, `liveByCourt`, `liveGate`, `.ms-live-badge`, `.set-live`, `.ms-board-set.live`, i18n key `live` — consistent across all tasks.

**Fix: add visibility handling to Task 6.**

---

## Task 6 (visibility amendment)

Apply after completing Task 6 step 4. The suite passes even without this — these tests are purely additive.

- [ ] **Step A: Add a failing visibility test**

Append to `__tests__/useLiveScore.test.tsx` inside the existing `describe`:

```ts
  it('disconnects after 60s of hidden visibility and reconnects on visible', () => {
    jest.useFakeTimers()
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    expect(mocked.__client.connect).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    jest.advanceTimersByTime(61000)
    expect(mocked.__client.disconnect).toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mocked.__client.connect).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })
```

- [ ] **Step B: Run test — verify it fails**

Run: `npx jest __tests__/useLiveScore.test.tsx -t visibility`
Expected: FAIL.

- [ ] **Step C: Extend `lib/useLiveScore.ts` with visibility handling**

Replace the `useEffect` body with:

```ts
  useEffect(() => {
    if (!tournamentId || !gateOpen) {
      clientRef.current?.disconnect()
      clientRef.current = null
      setMap(new Map())
      return
    }
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null

    const start = () => {
      if (clientRef.current) return
      const client = new LiveScoreClient()
      clientRef.current = client
      client.on('scoreboard', (courts) => {
        const next = new Map<string, CourtLive>()
        for (const c of courts) next.set(c.courtKey, c)
        setMap(next)
      })
      client.connect(tournamentId)
    }
    const stop = () => {
      clientRef.current?.disconnect()
      clientRef.current = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => { stop() }, 60000)
      } else {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null }
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (hiddenTimer) clearTimeout(hiddenTimer)
      stop()
    }
  }, [tournamentId, gateOpen])
```

- [ ] **Step D: Run tests — verify all pass**

Run: `npx jest __tests__/useLiveScore.test.tsx`
Expected: PASS — 7 cases green.

- [ ] **Step E: Commit**

```bash
git add lib/useLiveScore.ts __tests__/useLiveScore.test.tsx
git commit -m "Pause live-score WebSocket when tab hidden > 60s"
```
