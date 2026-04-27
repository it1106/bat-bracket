/** @jest-environment jsdom */
import posthog from 'posthog-js'
import { track, registerGlobals } from '@/lib/analytics'

describe('analytics helper', () => {
  it('track() does not throw and does not call posthog when uninitialized', () => {
    const spy = jest.spyOn(posthog, 'capture').mockImplementation(() => undefined as any)
    expect(() => track('some_event', { foo: 1 })).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('registerGlobals() does not throw and does not call posthog when uninitialized', () => {
    const spy = jest.spyOn(posthog, 'register').mockImplementation(() => undefined as any)
    expect(() => registerGlobals({ foo: 'bar' })).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
