/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useLiveScore } from '@/lib/useLiveScore'
import type { CourtLive } from '@/lib/live-score'
import { track } from '@/lib/analytics'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
const trackMock = track as unknown as jest.Mock

type ClientMock = {
  connect: jest.Mock
  disconnect: jest.Mock
  on: jest.Mock
  emit: (ev: 'scoreboard' | 'state', arg: unknown) => void
}

jest.mock('../lib/live-score', () => {
  const actual = jest.requireActual('../lib/live-score')
  const listeners: Record<string, Array<(a: unknown) => void>> = {}
  const client = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((ev: string, cb: (a: unknown) => void) => {
      ;(listeners[ev] ||= []).push(cb)
    }),
    emit: (ev: string, arg: unknown) => (listeners[ev] || []).forEach((cb) => cb(arg)),
    _reset: () => {
      for (const k of Object.keys(listeners)) delete listeners[k]
    },
  }
  return {
    ...actual,
    LiveScoreClient: jest.fn(() => client),
    __client: client,
  }
})

import * as liveMod from '@/lib/live-score'
const mocked = liveMod as unknown as { __client: ClientMock & { _reset: () => void } }

describe('useLiveScore', () => {
  beforeEach(() => {
    mocked.__client.connect.mockClear()
    mocked.__client.disconnect.mockClear()
    mocked.__client.on.mockClear()
    mocked.__client._reset()
    trackMock.mockClear()
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
      courtKey: 'court1', courtName: 'Court 1', matchId: 5, event: 'WS', playerIds: ['10'],
      setScores: [], current: null, serving: 0, winner: 0,
      team1Points: 0, team2Points: 0, durationSec: 0,
    }
    act(() => { mocked.__client.emit('scoreboard', [sample]) })
    expect(result.current.get('court1')).toEqual(sample)
  })

  it('replaces the map wholesale on each scoreboard push', () => {
    const { result } = renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    const a: CourtLive = { courtKey: 'court1', courtName: 'Court 1', matchId: 1, event: 'WS', playerIds: [], setScores: [], current: null, serving: 0, winner: 0, team1Points: 0, team2Points: 0, durationSec: 0 }
    const b: CourtLive = { ...a, courtKey: 'court2', courtName: 'Court 2', matchId: 2 }
    act(() => { mocked.__client.emit('scoreboard', [a]) })
    act(() => { mocked.__client.emit('scoreboard', [b]) })
    expect(result.current.has('court1')).toBe(false)
    expect(result.current.has('court2')).toBe(true)
  })

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

  it('emits signalr_state_changed on every transition with prev/next states', () => {
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    act(() => { mocked.__client.emit('state', 'negotiating') })
    act(() => { mocked.__client.emit('state', 'subscribed') })
    act(() => { mocked.__client.emit('state', 'active') })
    const calls = trackMock.mock.calls.filter((c) => c[0] === 'signalr_state_changed')
    expect(calls).toHaveLength(3)
    expect(calls[0][1]).toEqual({ tournament_id: 'T1', from: 'init', to: 'negotiating' })
    expect(calls[1][1]).toEqual({ tournament_id: 'T1', from: 'negotiating', to: 'subscribed' })
    expect(calls[2][1]).toEqual({ tournament_id: 'T1', from: 'subscribed', to: 'active' })
  })

  it('emits live_view_active when transitioning into active, but only once per active streak', () => {
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    act(() => { mocked.__client.emit('state', 'subscribed') })
    act(() => { mocked.__client.emit('state', 'active') })
    act(() => { mocked.__client.emit('state', 'active') }) // duplicate ignored
    act(() => { mocked.__client.emit('state', 'reconnecting') })
    act(() => { mocked.__client.emit('state', 'active') }) // re-fires after gap
    const liveActiveCalls = trackMock.mock.calls.filter((c) => c[0] === 'live_view_active')
    expect(liveActiveCalls).toHaveLength(2)
    expect(liveActiveCalls[0][1]).toEqual({ tournament_id: 'T1' })
  })

  it('force-reconnects on foreground after a brief hide (under 60s)', () => {
    jest.useFakeTimers()
    renderHook(({ id, gate }) => useLiveScore(id, gate),
      { initialProps: { id: 'T1' as string | null, gate: true } })
    expect(mocked.__client.connect).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    jest.advanceTimersByTime(5000) // mobile OS would suspend the WS here
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mocked.__client.disconnect).toHaveBeenCalled()
    expect(mocked.__client.connect).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })
})
