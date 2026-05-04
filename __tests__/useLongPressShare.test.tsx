/**
 * @jest-environment jsdom
 */
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { useLongPressShare } from '@/lib/useLongPressShare'

function makeTouch(target: Element, clientY = 100): Touch {
  return { identifier: 0, target, clientX: 0, clientY, pageX: 0, pageY: 0, screenX: 0, screenY: 0, radiusX: 0, radiusY: 0, rotationAngle: 0, force: 0 } as Touch
}

function fireTouch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', clientY = 100) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [makeTouch(target, clientY)] })
  Object.defineProperty(ev, 'changedTouches', { value: [makeTouch(target, clientY)] })
  Object.defineProperty(ev, 'target', { value: target, configurable: true })
  target.dispatchEvent(ev)
}

function Harness({ onFire }: { onFire: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLongPressShare(ref, { matchSelector: '.row', onFire, holdMs: 500 })
  return (
    <div ref={ref} data-testid="container">
      <div className="row" data-testid="row1" />
      <div className="row" data-testid="row2" />
      <div data-testid="not-a-row" />
    </div>
  )
}

describe('useLongPressShare', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('fires onFire with the matched element after holdMs', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    expect(onFire).not.toHaveBeenCalled()
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith(row1)
  })

  it('does not fire when touchstart hits a non-matching descendant', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const notRow = getByTestId('not-a-row')
    act(() => { fireTouch(notRow, 'touchstart') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not fire when touch ends before holdMs', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { jest.advanceTimersByTime(300) })
    act(() => { fireTouch(row1, 'touchend') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not fire when touch moves more than slop', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart', 100) })
    act(() => { fireTouch(row1, 'touchmove', 130) })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does not fire on touchcancel', () => {
    const onFire = jest.fn()
    const { getByTestId } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    act(() => { fireTouch(row1, 'touchcancel') })
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('toggles pressClass on the matched element during the hold', () => {
    const { getByTestId } = render(<Harness onFire={() => {}} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    expect(row1.classList.contains('ms-match--pressing')).toBe(true)
    act(() => { fireTouch(row1, 'touchend') })
    expect(row1.classList.contains('ms-match--pressing')).toBe(false)
  })

  it('cleans up timer and listeners on unmount', () => {
    const onFire = jest.fn()
    const { getByTestId, unmount } = render(<Harness onFire={onFire} />)
    const row1 = getByTestId('row1')
    act(() => { fireTouch(row1, 'touchstart') })
    unmount()
    act(() => { jest.advanceTimersByTime(500) })
    expect(onFire).not.toHaveBeenCalled()
  })
})
