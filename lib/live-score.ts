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

// /signalr/negotiate, /signalr/start, /signalr/abort are blocked by CORS
// when called directly from the browser, so route them through our own
// Next.js API proxy. The WebSocket itself does not need a proxy — browsers
// allow cross-origin WebSocket handshakes.
const HUB_HTTP_BASE = '/api/livescore'
const WS_HOST = 'wss://livescore.tournamentsoftware.com'
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
  private lastHeartbeat = 0
  private subscribeTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private sawCourts = false

  on<K extends keyof Events>(ev: K, cb: Events[K]) {
    this.listeners[ev].push(cb)
  }

  connect(tournamentId: string) {
    this.tournamentId = tournamentId
    this.setState('negotiating')
    void this.doNegotiate()
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.clearSubscribeTimer()
    this.tournamentId = null
    this.sawCourts = false
    this.reconnectAttempts = 0
    this.closeSocket()
    this.setState('idle')
  }

  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    for (const cb of this.listeners[ev]) (cb as (...a: unknown[]) => void)(...args)
  }

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
    if (s === 'active') {
      this.reconnectAttempts = 0
    }
  }

  private clearSubscribeTimer() {
    if (this.subscribeTimer) { clearTimeout(this.subscribeTimer); this.subscribeTimer = null }
  }

  private closeSocket() {
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
  }

  private async doNegotiate() {
    const qs = new URLSearchParams({
      clientProtocol: CLIENT_PROTOCOL,
      connectionData: CONNECTION_DATA,
      VClientID: VCLIENT_ID,
      _: String(Date.now()),
    })
    const url = `${HUB_HTTP_BASE}/negotiate?${qs}`
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
    try { await fetch(`${HUB_HTTP_BASE}/start?${qs}`) } catch { /* proceed */ }
    this.ws?.send(JSON.stringify({
      H: HUB_NAME, M: 'joinScoreboardNew', A: [this.tournamentId], I: 0,
    }))
    this.setState('subscribed')
  }

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
        if (courts.length > 0) {
          this.sawCourts = true
          if (this.state !== 'active') this.setState('active')
        }
        this.emit('scoreboard', courts)
      }
    }
  }

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
