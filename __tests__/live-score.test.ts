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

describe('LiveScoreClient — reconnect + disable', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    MockSocket.last = null
  })
  afterEach(() => jest.useRealTimers())

  async function runToSubscribed() {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }))
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
    await runToSubscribed()
    const firstSocket = MockSocket.last
    MockSocket.last!.simulateClose()
    jest.advanceTimersByTime(1100)
    await Promise.resolve(); await Promise.resolve()
    expect(MockSocket.last).not.toBeNull()
    expect(MockSocket.last).not.toBe(firstSocket)
  })

  it('goes to disabled after 5 failed reconnect attempts', async () => {
    const { fetchMock } = installMocks()
    fetchMock.mockResolvedValue(mockJsonOk({ ConnectionToken: 'TOK', ProtocolVersion: '1.5' }))
    const c = new LiveScoreClient()
    const states: string[] = []
    c.on('state', (s) => states.push(s))
    c.connect('GUID-X')
    await Promise.resolve(); await Promise.resolve()
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
