/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { usePathTarget, type PathTarget } from '@/lib/usePathTarget'

const TARGET: PathTarget = { drawNum: '5', drawName: 'BS U15', playerId: '1' }

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
    act(() => result.current.openPath(TARGET))
    expect(result.current.pathTarget).toEqual(TARGET)
    act(() => result.current.closePath())
    expect(result.current.pathTarget).toBeNull()
  })

  it('drops the path as soon as the player window closes', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET))
    rerender({ openPlayerId: undefined })
    expect(result.current.pathTarget).toBeNull()
  })

  it('does not bring the path back when the same player is opened again', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET))
    rerender({ openPlayerId: undefined })
    rerender({ openPlayerId: '1' })
    expect(result.current.pathTarget).toBeNull()
  })

  it('never shows one player\'s path under another player\'s window', () => {
    const { result, rerender } = setup()
    act(() => result.current.openPath(TARGET))
    rerender({ openPlayerId: '2' })
    expect(result.current.pathTarget).toBeNull()
    rerender({ openPlayerId: '1' })
    expect(result.current.pathTarget).toBeNull()
  })
})
