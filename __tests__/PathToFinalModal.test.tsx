/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PathToFinalModal from '@/components/PathToFinalModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PathResponse } from '@/lib/pathEnrich'
import type { MatchPlayer } from '@/lib/types'

const P = (name: string, playerId: string): MatchPlayer => ({ name, playerId })

const BASE: PathResponse = {
  team: [P('Anan Dee', '1')],
  seed: '5',
  eliminated: false,
  champion: false,
  stale: false,
  rounds: [
    { round: 'Round of 32', status: 'bye' },
    {
      round: 'Round of 16', status: 'won', opponent: [P('Beam Kla', '2')],
      scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }], walkover: false, retired: false,
    },
    {
      round: 'Quarter final', status: 'next', opponent: [P('Chai Yo', '3')], opponentSeed: '4',
      time: '14:30', court: 'Court 3', record: { wins: 1, losses: 2 },
    },
    {
      round: 'Semi final', status: 'future',
      candidates: [
        { team: [P('Dan Sri', '4')], seed: '1', rank: 2, record: { wins: 0, losses: 0 }, favourite: true },
        { team: [P('Ek Chai', '5')], rank: 30, record: { wins: 3, losses: 0 }, favourite: false },
        { team: [P('Fah Sai', '6')], record: null, favourite: false },
      ],
    },
    {
      round: 'Final', status: 'future',
      candidates: [
        { team: [P('Gun Dee', '7')], record: null, favourite: false },
        { team: [P('Hong Tae', '8')], record: null, favourite: false },
      ],
    },
  ],
}

function mockFetch(body: unknown, ok = true) {
  const fn = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function renderModal(extra: Partial<React.ComponentProps<typeof PathToFinalModal>> = {}) {
  return render(
    <LanguageProvider>
      <PathToFinalModal
        tournamentId="T1" drawNum="5" drawName="BS U15" playerId="1"
        onClose={() => {}} {...extra}
      />
    </LanguageProvider>,
  )
}

const rows = () => Array.from(document.querySelectorAll('.ptf-row'))
const rowText = (i: number) => rows()[i].textContent!.replace(/\s+/g, ' ').trim()

beforeEach(() => { localStorage.clear() })

describe('PathToFinalModal', () => {
  it('asks the path route for this player and draw', async () => {
    const fetchMock = mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(fetchMock).toHaveBeenCalledWith('/api/path?tournament=T1&draw=5&player=1')
  })

  it('shows loading, then the header', async () => {
    mockFetch(BASE)
    renderModal()
    expect(document.querySelector('.pm-loading')).not.toBeNull()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.pm-loading')).toBeNull()
    expect(document.querySelector('.ptf-title')!.textContent).toContain('Anan Dee')
    expect(document.querySelector('.ptf-title')!.textContent).toContain('BS U15')
  })

  it('renders one row per round, in order, with long round names', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(Array.from(document.querySelectorAll('.ptf-round')).map((e) => e.textContent)).toEqual([
      'Round of 32', 'Round of 16', 'Quarter Final', 'Semi Final', 'Final',
    ])
  })

  it('renders a bye, a win with its score, and the next match', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(0)).toContain('Bye')
    expect(rowText(1)).toContain('Won')
    expect(rowText(1)).toContain('Beam Kla')
    expect(rowText(1)).toContain('21–15, 21–18')
    expect(rowText(2)).toContain('Chai Yo')
    expect(rowText(2)).toContain('Seed 4')
    expect(rowText(2)).toContain('14:30')
    expect(rowText(2)).toContain('Court 3')
    expect(rowText(2)).toContain('Record 1–2')
  })

  it('shows the favourite and a count of the others', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(3)).toContain('Likely')
    expect(rowText(3)).toContain('Dan Sri')
    expect(rowText(3)).toContain('Seed 1')
    expect(rowText(3)).toContain('First meeting')
    expect(rowText(3)).toContain('+2 others')
    expect(rowText(3)).not.toContain('Ek Chai')
  })

  it('shows only a count when there is no favourite', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(4)).toContain('2 possible opponents')
    expect(rowText(4)).not.toContain('Likely')
    expect(rowText(4)).not.toContain('Gun Dee')
  })

  it('expands and collapses the full candidate list', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('+2 others'))
    expect(rowText(3)).toContain('Ek Chai')
    expect(rowText(3)).toContain('Rank 30')
    expect(rowText(3)).toContain('Record 3–0')
    expect(rowText(3)).toContain('Fah Sai')
    expect(rowText(4)).not.toContain('Gun Dee')
    fireEvent.click(screen.getByText('+2 others'))
    expect(rowText(3)).not.toContain('Ek Chai')
    fireEvent.click(screen.getByText('2 possible opponents'))
    expect(rowText(4)).toContain('Gun Dee')
    expect(rowText(4)).toContain('Hong Tae')
  })

  it('says nothing about a record it does not have', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('2 possible opponents'))
    expect(rowText(4)).not.toContain('Record')
    expect(rowText(4)).not.toContain('First meeting')
  })

  it('ends with an "out" line for an eliminated player', async () => {
    mockFetch({
      ...BASE, eliminated: true,
      rounds: [{
        round: 'Round of 16', status: 'lost', opponent: [P('Beam Kla', '2')],
        scores: [{ t1: 15, t2: 21 }, { t1: 18, t2: 21 }], walkover: false, retired: false,
      }],
    })
    renderModal()
    await screen.findByText('Round of 16')
    expect(rows()).toHaveLength(1)
    expect(rowText(0)).toContain('Lost')
    expect(document.querySelector('.ptf-end')!.textContent).toBe('Out in Round of 16')
  })

  it('calls the loser of the final the runner-up', async () => {
    mockFetch({
      ...BASE, eliminated: true,
      rounds: [{ round: 'Final', status: 'lost', opponent: [P('Beam Kla', '2')], scores: [{ t1: 19, t2: 21 }], walkover: false, retired: false }],
    })
    renderModal()
    await screen.findByText('Final')
    expect(document.querySelector('.ptf-end')!.textContent).toBe('Runner-up')
  })

  it('ends with a champion line', async () => {
    mockFetch({
      ...BASE, champion: true,
      rounds: [{ round: 'Final', status: 'won', opponent: [P('Beam Kla', '2')], scores: [{ t1: 21, t2: 9 }], walkover: false, retired: false }],
    })
    renderModal()
    await screen.findByText('Final')
    expect(document.querySelector('.ptf-end')!.textContent).toBe('Champion')
  })

  it('shows a walkover or retirement pill on a played round', async () => {
    mockFetch({
      ...BASE,
      rounds: [
        { round: 'Round of 16', status: 'won', opponent: [P('Beam Kla', '2')], scores: [], walkover: true, retired: false },
        { round: 'Quarter final', status: 'won', opponent: [P('Chai Yo', '3')], scores: [{ t1: 21, t2: 10 }, { t1: 5, t2: 2 }], walkover: false, retired: true },
      ],
    })
    renderModal()
    await screen.findByText('Round of 16')
    expect(rowText(0)).toContain('Walkover')
    expect(rowText(1)).toContain('Ret.')
  })

  it('names both players of a doubles pair', async () => {
    mockFetch({
      ...BASE, team: [P('Anan Dee', '1'), P('Krit Wong', '9')],
      rounds: [{ round: 'Final', status: 'next', opponent: [P('Beam Kla', '2'), P('Chai Yo', '3')], record: null }],
    })
    renderModal()
    await screen.findByText('Final')
    expect(document.querySelector('.ptf-title')!.textContent).toContain('Anan Dee / Krit Wong')
    expect(rowText(0)).toContain('Beam Kla')
    expect(rowText(0)).toContain('Chai Yo')
  })

  it('opens an opponent when their name is tapped', async () => {
    mockFetch(BASE)
    const onPlayerClick = jest.fn()
    renderModal({ onPlayerClick })
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('Chai Yo'))
    expect(onPlayerClick).toHaveBeenCalledWith('3')
  })

  it('shows the stale notice and the record note', async () => {
    mockFetch({ ...BASE, stale: true })
    renderModal()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.ptf-stale')!.textContent).toContain('BAT server is down')
    expect(document.querySelector('.ptf-note')!.textContent).toContain('tracked on BATMatch')
  })

  it('shows no stale notice for a fresh bracket', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.ptf-stale')).toBeNull()
  })

  it('shows an error, not endless loading, when the route says 404', async () => {
    mockFetch({ error: 'nope' }, false)
    renderModal()
    await waitFor(() => expect(document.querySelector('.ptf-error')).not.toBeNull())
    expect(document.querySelector('.ptf-error')!.textContent).toBe('Could not load the path for this draw.')
    expect(document.querySelector('.pm-loading')).toBeNull()
  })

  it('shows an error when the request itself fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    renderModal()
    await waitFor(() => expect(document.querySelector('.ptf-error')).not.toBeNull())
  })

  it('reloads, and drops the old rows, when it is pointed at another draw', async () => {
    const fetchMock = mockFetch(BASE)
    const view = renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('+2 others'))
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ...BASE, rounds: [{ round: 'Final', status: 'bye' }] }),
    })
    view.rerender(
      <LanguageProvider>
        <PathToFinalModal tournamentId="T1" drawNum="9" drawName="BD U15" playerId="1" onClose={() => {}} />
      </LanguageProvider>,
    )
    expect(document.querySelector('.pm-loading')).not.toBeNull()
    expect(rows()).toHaveLength(0)
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/path?tournament=T1&draw=9&player=1')
  })

  it('closes on the close button, the backdrop and Escape', async () => {
    mockFetch(BASE)
    const onClose = jest.fn()
    renderModal({ onClose })
    await screen.findByText('Quarter Final')
    fireEvent.click(document.querySelector('.pm-close')!)
    fireEvent.click(document.querySelector('.pm-overlay')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.click(document.querySelector('.pm-modal')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('renders in Thai', async () => {
    localStorage.setItem('batbracket.lang', 'th')
    mockFetch(BASE)
    renderModal()
    await waitFor(() => expect(rows().length).toBe(5))
    await waitFor(() => expect(rowText(0)).toContain('บาย'))
    expect(rowText(1)).toContain('ชนะ')
    expect(rowText(2)).toContain('สถิติ 1–2')
    expect(rowText(3)).toContain('คาดว่าเจอ')
    expect(rowText(3)).toContain('ยังไม่เคยเจอกัน')
    expect(rowText(3)).toContain('+อีก 2 ราย')
    expect(rowText(4)).toContain('คู่แข่งที่เป็นไปได้ 2 ราย')
  })

  it('words the "out" line in Thai without repeating รอบ', async () => {
    localStorage.setItem('batbracket.lang', 'th')
    mockFetch({
      ...BASE, eliminated: true,
      rounds: [{ round: 'Round of 16', status: 'lost', opponent: [P('Beam Kla', '2')], scores: [], walkover: false, retired: false }],
    })
    renderModal()
    await waitFor(() => expect(document.querySelector('.ptf-end')?.textContent).toBe('ตกรอบในรอบ 16'))
  })
})
