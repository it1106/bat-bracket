/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))

import { track } from '@/lib/analytics'
import { usePathTarget, type PathTarget } from '@/lib/usePathTarget'

const TARGET: PathTarget = { drawNum: '5', drawName: 'BS U15', playerId: '1' }
const CTX = { tournamentId: 'T1', tournamentName: 'The Open' }

const setup = (id: string | undefined = '1') =>
  renderHook(({ openPlayerId }: { openPlayerId: string | undefined }) => usePathTarget(openPlayerId), {
    initialProps: { openPlayerId: id } as { openPlayerId: string | undefined },
  })

describe('usePathTarget', () => {
  it('starts with no path open', () => {
    expect(setup().result.current.pathTarget).toBeNull()
  })

  it('opens and closes a path for the player whose window is open', () => {
    const { result } = setup()
    act(() => result.current.openPath(TARGET, CTX))
    expect(result.current.pathTarget).toEqual(TARGET)
    act(() => result.current.closePath())
    expect(result.current.pathTarget).toBeNull()
  })

  it('drops the path as soon as the player window closes', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET, CTX))
    rerender({ openPlayerId: undefined })
    expect(result.current.pathTarget).toBeNull()
  })

  it('does not bring the path back when the same player is opened again', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET, CTX))
    rerender({ openPlayerId: undefined })
    rerender({ openPlayerId: '1' })
    expect(result.current.pathTarget).toBeNull()
  })

  it('never shows one player\'s path under another player\'s window', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET, CTX))
    rerender({ openPlayerId: '2' })
    expect(result.current.pathTarget).toBeNull()
    rerender({ openPlayerId: '1' })
    expect(result.current.pathTarget).toBeNull()
  })

describe('usePathTarget analytics', () => {
  const trackMock = track as jest.Mock
  beforeEach(() => trackMock.mockReset())

  it('reports the panel being opened, with the tournament and the draw', () => {
    const { result } = setup()
    act(() => result.current.openPath(TARGET, { tournamentId: 'T1', tournamentName: 'The Open' }))
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('path_to_final_opened', {
      tournament_id: 'T1',
      tournament_name: 'The Open',
      draw: 'BS U15',
      draw_id: '5',
    })
  })

  it('reports nothing when the panel closes or the window moves on', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET, { tournamentId: 'T1', tournamentName: 'The Open' }))
    trackMock.mockReset()
    act(() => result.current.closePath())
    rerender({ openPlayerId: undefined })
    expect(trackMock).not.toHaveBeenCalled()
  })
})
})
