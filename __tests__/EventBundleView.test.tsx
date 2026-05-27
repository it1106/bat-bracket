/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import EventBundleView, { computeQualifierCount } from '../components/EventBundleView'
import type { EventBundle } from '../lib/types'

jest.mock('../components/BracketCanvas', () => ({
  __esModule: true,
  default: ({ bracketHtml }: { bracketHtml: string }) =>
    <div data-testid="bracket-canvas">{bracketHtml || 'empty playoff'}</div>,
}))

jest.mock('../lib/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en' }),
}))

const bundle: EventBundle = {
  eventName: 'BS U11',
  playoff: { html: '<div>playoff</div>', format: 'single-elimination' },
  playoffDrawNum: '9',
  groups: [
    { drawNum: '1', groupLetter: 'A', standings: [
      { position: 1, players: [{ name: 'Alice', playerId: '11' }], played: 0, won: 0, drawn: 0, lost: 0, matches: '0-0', games: '0-0', points: '0-0', pts: 0 },
    ], matches: [] },
    { drawNum: '2', groupLetter: 'B', standings: [
      { position: 1, players: [{ name: 'Bob', playerId: '22' }], played: 0, won: 0, drawn: 0, lost: 0, matches: '0-0', games: '0-0', points: '0-0', pts: 0 },
    ], matches: [] },
  ],
}

describe('EventBundleView', () => {
  it('renders Groups tab by default with all group cards', () => {
    render(<EventBundleView bundle={bundle} playerQuery="" />)
    expect(screen.getByText('Group A')).toBeInTheDocument()
    expect(screen.getByText('Group B')).toBeInTheDocument()
  })

  it('switches to Playoff tab and renders BracketCanvas', () => {
    render(<EventBundleView bundle={bundle} playerQuery="" />)
    fireEvent.click(screen.getByRole('button', { name: /playoff/i }))
    expect(screen.getByTestId('bracket-canvas')).toBeInTheDocument()
  })

  it('dims the Playoff tab when the bracket has no populated entrants (byes/TBD)', () => {
    render(<EventBundleView bundle={bundle} playerQuery="" />)
    const playoffBtn = screen.getByRole('button', { name: /playoff/i })
    expect(playoffBtn.className).toContain('opacity-40')
    expect(playoffBtn).toHaveAttribute('title')
  })

  it('does not dim the Playoff tab once a real entrant is populated', () => {
    const seeded: EventBundle = {
      ...bundle,
      playoff: { html: '<span class="bk-player" data-player-id="99">Carol</span>', format: 'single-elimination' },
    }
    render(<EventBundleView bundle={seeded} playerQuery="" />)
    const playoffBtn = screen.getByRole('button', { name: /playoff/i })
    expect(playoffBtn.className).not.toContain('opacity-40')
    expect(playoffBtn).not.toHaveAttribute('title')
  })
})

describe('computeQualifierCount', () => {
  it('returns 1 when playoff size equals group count', () => {
    expect(computeQualifierCount(8, 8)).toBe(1)
  })
  it('returns 2 when playoff has twice the slots', () => {
    expect(computeQualifierCount(8, 4)).toBe(2)
  })
  it('clamps to a minimum of 1', () => {
    expect(computeQualifierCount(0, 8)).toBe(1)
  })
})
