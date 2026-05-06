import { captureServerEvent, _resetForTest } from '@/lib/posthog-server'

describe('captureServerEvent', () => {
  beforeEach(() => {
    _resetForTest()
  })

  it('does not throw when POSTHOG key is missing', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    await expect(
      captureServerEvent('test_event', { foo: 1 }),
    ).resolves.toBeUndefined()
  })

  it('does not throw when POSTHOG key is set (network may fail)', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_dummy'
    await expect(
      captureServerEvent('test_event', { foo: 1 }),
    ).resolves.toBeUndefined()
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  })
})
