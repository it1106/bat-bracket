/**
 * @jest-environment jsdom
 */
// The tournament page asks the server for several things at once and lets the
// reader move on before they answer. An answer to a question the reader has
// already left behind — the previous tournament, day, draw or player — must
// never land on the screen over what they are looking at now.
//
// These tests render the real page with a server whose answers can be held
// back and released out of order.
jest.mock('../lib/useLiveScore', () => ({ useLiveScore: () => mockLive.current }))
jest.mock('../lib/analytics', () => ({ track: jest.fn(), setPersonProps: jest.fn() }))

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import Home from '@/app/page'
import { LanguageProvider } from '@/lib/LanguageContext'
import { ThemeProvider } from '@/lib/ThemeContext'

// What the (mocked) live-score feed reports: court → the match on it.
/* eslint-disable no-var */
var mockLive: { current: Map<string, { matchId: number; playerIds: string[]; event: string }> }
/* eslint-enable no-var */
mockLive = { current: new Map() }

const A = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
const B = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB'
const D1 = '25690602'
const D2 = '25690603'

const tournaments = [
  { id: A, name: 'Alpha Open', provider: 'bat' },
  { id: B, name: 'Beta Open', provider: 'bat' },
]
// Both days in the past, so the page does not go looking at future days.
const days = [
  { date: D1, label: '02/06', dateIso: '2026-06-02', hasMatches: true },
  { date: D2, label: '03/06', dateIso: '2026-06-03', hasMatches: true },
]
const schedule = (player: string, playerId = '100') => ({
  groups: [{
    type: 'time', time: '10:00',
    matches: [{
      draw: 'MS', drawNum: '1', round: 'QF',
      team1: [{ name: player, playerId }], team2: [{ name: `${player} Opponent`, playerId: `${playerId}9` }],
      winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
      h2hUrl: `/head-2-head?who=${encodeURIComponent(player)}`,
    }],
  }],
})
const fullSchedule = (player: string) => ({ days, currentDate: D1, ...schedule(player) })
const drawList = (prefix: string) => [
  { drawNum: '1', name: `${prefix} Singles`, size: '32', type: 'Elimination' },
  { drawNum: '2', name: `${prefix} Doubles`, size: '32', type: 'Elimination' },
]
const bracket = (player: string) => ({
  format: 'single-elimination', entrantCount: 2,
  html: '<div class="bk-wrap"><div class="bk-round"><div class="bk-round-label" data-round-index="0">Final</div>' +
    '<div class="bk-match-slot"><div class="bk-match-box"><div class="bk-row"><div class="bk-team-players">' +
    `<span class="bk-player">${player}</span></div></div></div></div></div></div>`,
})
const profile = (name: string, playerId: string) => ({ playerId, name, club: 'Club', yob: '', events: [], matches: [] })
const h2h = (player1: string) => ({ player1, player2: 'Other', records: [], matches: [] })

// ── A server whose answers can be held back ─────────────────────────────────
type Answer = unknown | ((url: string) => unknown)
let routes: Array<{ match: (url: string) => boolean; answer: Answer }> = []
let held: Array<{ match: (url: string) => boolean; waiting: Array<{ url: string; send: (body: unknown) => void }> }> = []

const response = (body: unknown) => ({
  ok: true, status: 200, headers: new Headers(),
  text: async () => JSON.stringify(body), json: async () => body,
})
const has = (...parts: string[]) => (url: string) => parts.every((p) => url.includes(p))
/** Exactly the request for one day (not the same day asked fresh). */
const dayOf = (id: string, date: string) => (url: string) => url.endsWith(`/api/matches?tournament=${id}&date=${date}`)
const fullOf = (id: string) => (url: string) => url.endsWith(`/api/matches?tournament=${id}`)

function serve(match: (url: string) => boolean, answer: Answer) {
  routes.unshift({ match, answer })
}
/** Holds back every answer to requests matching `match` until released. */
function hold(match: (url: string) => boolean) {
  const entry = { match, waiting: [] as Array<{ url: string; send: (body: unknown) => void }> }
  held.unshift(entry)
  return {
    asked: () => entry.waiting.length,
    /** Answers everything held so far, and lets the page take it in. */
    release: async (answer: Answer) => {
      await act(async () => {
        for (const w of entry.waiting.splice(0)) w.send(typeof answer === 'function' ? (answer as (u: string) => unknown)(w.url) : answer)
      })
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  mockLive.current = new Map()
  routes = []
  held = []
  serve(() => true, {})
  serve(has('/api/tournaments'), tournaments)
  serve(has('/api/clubs'), {})
  serve(has('/api/overview'), { notes: [], seedEvents: [] })
  for (const [id, who] of [[A, 'Alice'], [B, 'Bob']] as const) {
    serve(has('/api/draws', id), drawList(who))
    serve(fullOf(id), fullSchedule(`${who} Monday`))
    serve(dayOf(id, D1), schedule(`${who} Monday`))
    serve(dayOf(id, D2), schedule(`${who} Tuesday`))
    serve(has('/api/bracket', id, 'event=1'), bracket(`${who} In Singles`))
    serve(has('/api/bracket', id, 'event=2'), bracket(`${who} In Doubles`))
  }
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const holding = held.find((h) => h.match(url))
    if (holding) {
      return new Promise((resolve) => { holding.waiting.push({ url, send: (body) => resolve(response(body)) }) })
    }
    const route = routes.find((r) => r.match(url))!
    return Promise.resolve(response(typeof route.answer === 'function' ? (route.answer as (u: string) => unknown)(url) : route.answer))
  }) as unknown as typeof fetch
})
afterEach(() => { jest.useRealTimers() })

async function openPage() {
  await act(async () => {
    render(<LanguageProvider><ThemeProvider><Home /></ThemeProvider></LanguageProvider>)
  })
  await screen.findByRole('option', { name: 'Alpha Open' })
}
const tournamentSelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement
async function choose(select: HTMLElement, value: string) {
  await act(async () => { fireEvent.change(select, { target: { value } }) })
}
async function click(el: HTMLElement) {
  await act(async () => { fireEvent.click(el) })
}
const shown = (text: string) => screen.queryAllByText(text).length > 0
/** The clickable name of a player in the schedule. */
const playerLink = (name: string) =>
  screen.getAllByText(name).find((el) => el.className.includes('pm-player-link')) as HTMLElement

describe('switching tournament before the first one has answered', () => {
  it('shows the second tournament\'s schedule, not the first one\'s late answer', async () => {
    const slowFull = hold(fullOf(A))
    await openPage()
    await choose(tournamentSelect(), A)
    await choose(tournamentSelect(), B)
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))

    await slowFull.release(fullSchedule('Alice Monday'))

    expect(shown('Bob Monday')).toBe(true)
    expect(shown('Alice Monday')).toBe(false)
  })

  it('lists the second tournament\'s draws, not the first one\'s late answer', async () => {
    const slowDraws = hold(has('/api/draws', A))
    await openPage()
    await choose(tournamentSelect(), A)
    await choose(tournamentSelect(), B)
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))

    await slowDraws.release(drawList('Alice'))
    await click(screen.getByRole('button', { name: 'Bracket' }))

    expect(screen.queryByRole('option', { name: 'Bob Singles' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'Alice Singles' })).toBeNull()
  })

  it('does not let the first tournament\'s enriched day replace the second one\'s', async () => {
    const slowDay = hold(dayOf(A, D1))
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(slowDay.asked()).toBe(1))
    await choose(tournamentSelect(), B)
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))

    await slowDay.release(schedule('Alice Monday Enriched'))

    expect(shown('Bob Monday')).toBe(true)
    expect(shown('Alice Monday Enriched')).toBe(false)
  })

  it('stops showing "loading" for the second tournament only when the second has answered', async () => {
    const slowA = hold(fullOf(A))
    const slowB = hold(fullOf(B))
    await openPage()
    await choose(tournamentSelect(), A)
    await choose(tournamentSelect(), B)
    await waitFor(() => expect(slowB.asked()).toBe(1))

    // The first tournament's answer arrives. The reader is still waiting for
    // the second, so nothing of the first may appear and the wait goes on.
    await slowA.release(fullSchedule('Alice Monday'))
    expect(shown('Alice Monday')).toBe(false)

    await slowB.release(fullSchedule('Bob Monday'))
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))
  })
})

describe('clearing the tournament before it has answered', () => {
  it('does not leave the page loading, or fill it in later', async () => {
    const slowFull = hold(fullOf(A))
    const slowDraws = hold(has('/api/draws', A))
    await openPage()
    await choose(tournamentSelect(), A)
    await choose(tournamentSelect(), '')

    await slowFull.release(fullSchedule('Alice Monday'))
    await slowDraws.release(drawList('Alice'))

    // Pick another tournament and hold its answers: anything still marked as
    // loading from the cleared one would show while these wait.
    const slowB = hold(fullOf(B))
    await choose(tournamentSelect(), B)
    await slowB.release(fullSchedule('Bob Monday'))
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))
    expect(shown('Alice Monday')).toBe(false)
  })

  it('stops the "loading" marks straight away', async () => {
    hold(fullOf(A))
    hold(has('/api/draws', A))
    await openPage()
    await choose(tournamentSelect(), A)
    await click(screen.getByRole('button', { name: 'Bracket' }))
    expect(screen.getAllByRole('combobox')[1]).toBeDisabled()

    await choose(tournamentSelect(), '')

    // With no tournament there is nothing to load: the draw list must not
    // stay greyed out as though one were on its way.
    expect(document.querySelector('[class*="ml-1 opacity-50"]')).toBeNull()
    expect(screen.queryByText(/Loading/)).toBeNull()
  })
})

describe('switching day before an earlier answer has arrived', () => {
  it('keeps the day the reader chose when the opening day\'s background answer comes late', async () => {
    const slowDay = hold(dayOf(A, D1))
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(slowDay.asked()).toBe(1))

    await click(screen.getByRole('button', { name: '03/06' }))
    await waitFor(() => expect(shown('Alice Tuesday')).toBe(true))

    await slowDay.release(schedule('Alice Monday Enriched'))

    expect(shown('Alice Tuesday')).toBe(true)
    expect(shown('Alice Monday Enriched')).toBe(false)
  })

  it('keeps the day the reader chose when a live-match refetch of the old day comes late', async () => {
    jest.useFakeTimers()
    const slowFresh = hold(has('/api/matches', A, `date=${D1}`, 'fresh=1'))
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(shown('Alice Monday')).toBe(true))

    // A match is on court 1, then it ends: the page waits five seconds and
    // asks for the day again, fresh.
    mockLive.current = new Map([['c1', { matchId: 7, playerIds: [], event: '' }]])
    await click(screen.getAllByRole('checkbox')[0])
    mockLive.current = new Map()
    await click(screen.getAllByRole('checkbox')[0])
    await act(async () => { jest.advanceTimersByTime(5_000) })
    expect(slowFresh.asked()).toBe(1)

    await click(screen.getByRole('button', { name: '03/06' }))
    await waitFor(() => expect(shown('Alice Tuesday')).toBe(true))

    await slowFresh.release(schedule('Alice Monday Final Score'))

    expect(shown('Alice Tuesday')).toBe(true)
    expect(shown('Alice Monday Final Score')).toBe(false)
  })
})

describe('choosing another draw before the first bracket has arrived', () => {
  async function openBracketTab() {
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(shown('Alice Monday')).toBe(true))
    await click(screen.getByRole('button', { name: 'Bracket' }))
    return screen.getAllByRole('combobox')[1]
  }

  it('shows the bracket of the draw chosen last', async () => {
    const slowSingles = hold(has('/api/bracket', A, 'event=1'))
    const drawSelect = await openBracketTab()
    await choose(drawSelect, '1')
    await choose(drawSelect, '2')
    await waitFor(() => expect(shown('Alice In Doubles')).toBe(true))

    await slowSingles.release(bracket('Alice In Singles'))

    expect(shown('Alice In Doubles')).toBe(true)
    expect(shown('Alice In Singles')).toBe(false)
  })

  it('does not bring a bracket back after the reader has switched tournament', async () => {
    const slowSingles = hold(has('/api/bracket', A, 'event=1'))
    const drawSelect = await openBracketTab()
    await choose(drawSelect, '1')
    await choose(tournamentSelect(), B)
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))

    await slowSingles.release(bracket('Alice In Singles'))
    await click(screen.getByRole('button', { name: 'Bracket' }))

    expect(shown('Alice In Singles')).toBe(false)
  })
})

describe('the bracket\'s loading state when its request is left behind', () => {
  it('does not stay on "loading" after the reader switches tournament mid-load', async () => {
    const slowSingles = hold(has('/api/bracket', A, 'event=1'))
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(shown('Alice Monday')).toBe(true))
    await click(screen.getByRole('button', { name: 'Bracket' }))
    await choose(screen.getAllByRole('combobox')[1], '1')
    expect(shown('Loading bracket…')).toBe(true)

    await choose(tournamentSelect(), B)
    await waitFor(() => expect(shown('Bob Monday')).toBe(true))
    await click(screen.getByRole('button', { name: 'Bracket' }))
    expect(shown('Loading bracket…')).toBe(false)

    await slowSingles.release(bracket('Alice In Singles'))
    expect(shown('Loading bracket…')).toBe(false)
  })

  it('does not stay on "loading" after the reader clears the draw mid-load', async () => {
    const slowSingles = hold(has('/api/bracket', A, 'event=1'))
    await openPage()
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(shown('Alice Monday')).toBe(true))
    await click(screen.getByRole('button', { name: 'Bracket' }))
    const drawSelect = screen.getAllByRole('combobox')[1]
    await choose(drawSelect, '1')
    await choose(drawSelect, '')
    expect(shown('Loading bracket…')).toBe(false)

    await slowSingles.release(bracket('Alice In Singles'))
    expect(shown('Alice In Singles')).toBe(false)
  })
})

describe('the player and head-to-head panels', () => {
  async function openSchedule() {
    await openPage()
    serve(dayOf(A, D1), {
      groups: [{ type: 'time', time: '10:00', matches: [
        ...schedule('Alice Monday', '100').groups[0].matches,
        ...schedule('Carol Monday', '200').groups[0].matches,
      ] }],
    })
    await choose(tournamentSelect(), A)
    await waitFor(() => expect(shown('Carol Monday')).toBe(true))
  }

  it('show the player clicked last when an earlier one answers late', async () => {
    const slowAlice = hold(has('/api/player', 'player=100'))
    serve(has('/api/player', 'player=200'), profile('Carol Profile', '200'))
    await openSchedule()
    await click(playerLink('Alice Monday'))
    await click(playerLink('Carol Monday'))
    await waitFor(() => expect(shown('Carol Profile')).toBe(true))

    await slowAlice.release(profile('Alice Profile', '100'))

    expect(shown('Carol Profile')).toBe(true)
    expect(shown('Alice Profile')).toBe(false)
  })

  it('stay closed when the reader closes the player panel before it has loaded', async () => {
    const slowAlice = hold(has('/api/player', 'player=100'))
    await openSchedule()
    await click(playerLink('Alice Monday'))
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })

    await slowAlice.release(profile('Alice Profile', '100'))

    expect(shown('Alice Profile')).toBe(false)
  })

  it('show the head-to-head asked for last when an earlier one answers late', async () => {
    const slowAlice = hold(has('/api/h2h', 'Alice'))
    serve(has('/api/h2h', 'Carol'), h2h('Carol Record'))
    await openSchedule()
    const buttons = screen.getAllByRole('button', { name: 'H2H' })
    await click(buttons[0])
    await click(buttons[1])
    await waitFor(() => expect(shown('Carol Record')).toBe(true))

    await slowAlice.release(h2h('Alice Record'))

    expect(shown('Carol Record')).toBe(true)
    expect(shown('Alice Record')).toBe(false)
  })
})
