/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
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
  courtKey: '3', courtName: 'Court 3', matchId: 42, event: 'WS', playerIds: ['100', '200'],
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
    renderWith(entry(), new Map([['3', live()]]))
    expect(screen.getAllByText('LIVE')[0]).toHaveClass('ms-live-badge')
    const liveSet = screen.getByText('11-9')
    expect(liveSet).toHaveClass('set-live')
  })

  it('suppresses the green ms-now-playing pulse when a live record matches', () => {
    const { container } = renderWith(entry(), new Map([['3', live()]]))
    expect(container.querySelector('.ms-now-playing')).toBeNull()
  })

  it('keeps the green pulse when no live record matches', () => {
    const { container } = renderWith(entry(), new Map())
    expect(container.querySelector('.ms-now-playing')).not.toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
  })

  it('shows LIVE badge but no set-live span between games (current=null)', () => {
    renderWith(entry(), new Map([['3', live({ current: null })]]))
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(document.querySelector('.set-live')).toBeNull()
  })

  it('does not render LIVE when the match is nowPlaying but player IDs do not overlap', () => {
    const unrelated = live({ playerIds: ['555'] })
    renderWith(entry(), new Map([['3', unrelated]]))
    expect(screen.queryByText('LIVE')).toBeNull()
  })

  it('shows the real court name from live data when scraped court is "Now playing"', () => {
    const { container } = renderWith(
      entry({ court: 'Now playing' }),
      new Map([['3', live()]]),
    )
    expect(container.querySelector('.ms-court')?.textContent).toBe('Court 3')
  })
})

// ── Jump-to-next tests ──────────────────────────────────────────────────

type IoCtor = typeof IntersectionObserver
type IoCallback = ConstructorParameters<IoCtor>[0]

let ioInstances: Array<{ cb: IoCallback; el: Element | null; disconnect: jest.Mock }> = []

function installIoMock() {
  ioInstances = []
  class MockIO {
    cb: IoCallback
    el: Element | null = null
    disconnect = jest.fn()
    constructor(cb: IoCallback) {
      this.cb = cb
      ioInstances.push(this)
    }
    observe(el: Element) { this.el = el }
    unobserve() {}
    takeRecords() { return [] }
    root = null
    rootMargin = ''
    thresholds: number[] = []
  }
  ;(globalThis as unknown as { IntersectionObserver: IoCtor }).IntersectionObserver = MockIO as unknown as IoCtor
}

function emitIntersection(isIntersecting: boolean) {
  for (const io of ioInstances) {
    if (!io.el) continue
    const entry = { isIntersecting, target: io.el } as unknown as IntersectionObserverEntry
    io.cb([entry], io as unknown as IntersectionObserver)
  }
}

function renderMany(matches: MatchEntry[], playerQuery = '') {
  const groups: MatchScheduleGroup[] = [{ type: 'time', time: '10:00', matches }]
  return render(
    <LanguageProvider>
      <MatchSchedule
        groups={groups}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery={playerQuery}
      />
    </LanguageProvider>,
  )
}

describe('MatchSchedule — jump to next', () => {
  beforeEach(() => {
    installIoMock()
  })

  it('does not render the button when there are no unplayed matches', () => {
    renderMany([entry({ winner: 1 }), entry({ winner: 2 })])
    expect(screen.queryByRole('button', { name: /next match/i })).toBeNull()
  })

  it('renders the button when the unplayed target is reported off-screen', async () => {
    renderMany([entry({ winner: 1 }), entry({ winner: null })])
    await act(async () => { emitIntersection(false) })
    expect(screen.getByRole('button', { name: /next match/i })).toBeInTheDocument()
  })

  it('hides the button when the target is reported on-screen', async () => {
    renderMany([entry({ winner: 1 }), entry({ winner: null })])
    await act(async () => { emitIntersection(false) })
    expect(screen.getByRole('button', { name: /next match/i })).toBeInTheDocument()
    await act(async () => { emitIntersection(true) })
    expect(screen.queryByRole('button', { name: /next match/i })).toBeNull()
  })

  it('clicking the button calls scrollIntoView and adds ms-jump-flash to the target', async () => {
    const scrollSpy = jest.fn()
    const origProto = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof origProto

    const { container } = renderMany([
      entry({ winner: 1 }),
      entry({ winner: null, team1: [{ name: 'Target', playerId: '9' }] }),
    ])
    await act(async () => { emitIntersection(false) })

    const btn = screen.getByRole('button', { name: /next match/i })
    await act(async () => { btn.click() })

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    const flashed = container.querySelector('.ms-match.ms-jump-flash')
    expect(flashed).not.toBeNull()

    HTMLElement.prototype.scrollIntoView = origProto
  })

  it('hides the button when the player filter matches no unplayed match', async () => {
    renderMany(
      [entry({ winner: 1 }), entry({ winner: null, team1: [{ name: 'Alpha', playerId: '1' }] })],
      'nobody-matches-this',
    )
    await act(async () => { emitIntersection(false) })
    expect(screen.queryByRole('button', { name: /next match/i })).toBeNull()
  })
})

// ── Playing-order tests ─────────────────────────────────────────────────

describe('MatchSchedule — playing order', () => {
  function multiGroup(matches: MatchEntry[]): MatchScheduleGroup[] {
    return [{ type: 'time', time: '10:00', matches }]
  }

  it('renders "Up next" pill on the first eligible match after a live anchor', () => {
    const matches = [
      entry({ winner: 1, nowPlaying: false, scores: [{ t1: 21, t2: 15 }] }),
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const pills = container.querySelectorAll('.ms-order-pill')
    expect(pills.length).toBe(2)
    expect(pills[0]).toHaveClass('ms-order-pill--next')
    expect(pills[0]?.textContent).toBe('Up next')
    expect(pills[1]).not.toHaveClass('ms-order-pill--next')
    expect(pills[1]?.textContent).toBe('2 away')
  })

  it('renders "N away" with the correct number on later positions', () => {
    const matches = [
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const texts = Array.from(container.querySelectorAll('.ms-order-pill')).map(
      (el) => el.textContent,
    )
    expect(texts).toEqual(['Up next', '2 away', '3 away'])
  })

  it('renders no pill on live, completed, or walkover rows', () => {
    const matches = [
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ winner: 1, nowPlaying: false, scores: [{ t1: 21, t2: 0 }] }),
      entry({ walkover: true, nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const pills = container.querySelectorAll('.ms-order-pill')
    expect(pills.length).toBe(2)
    expect(Array.from(pills).map((p) => p.textContent)).toEqual(['Up next', '2 away'])
  })

  it('numbers from "Up next" when the day has no live or completed match yet', () => {
    const matches = [
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const pills = container.querySelectorAll('.ms-order-pill')
    expect(Array.from(pills).map((p) => p.textContent)).toEqual(['Up next', '2 away'])
  })

  it('keeps positions stable when a player filter hides earlier rows', () => {
    const matches = [
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, team1: [{ name: 'Alpha', playerId: '1' }], scores: [] }),
      entry({
        nowPlaying: false,
        team1: [{ name: 'Beta', playerId: '2' }],
        team2: [{ name: 'Gamma', playerId: '3' }],
        scores: [],
      }),
      entry({ nowPlaying: false, team1: [{ name: 'Alpha', playerId: '4' }], scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
        />
      </LanguageProvider>,
    )
    const texts = Array.from(container.querySelectorAll('.ms-order-pill')).map(
      (el) => el.textContent,
    )
    expect(texts).toEqual(['Up next', '3 away'])
  })
})
