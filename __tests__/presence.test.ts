import { PresenceStore, ONLINE_WINDOW_MS, isValidDeviceId } from '@/lib/presence'

describe('PresenceStore', () => {
  it('counts each device once, however often it pings', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-aaaa', 1000)
    s.touch('device-bbbb', 2000)
    expect(s.count(2000)).toBe(2)
  })

  it('drops devices that stopped pinging after the online window', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-bbbb', 60_000)
    expect(s.count(ONLINE_WINDOW_MS)).toBe(2)
    expect(s.count(ONLINE_WINDOW_MS + 1)).toBe(1)
    expect(s.count(60_000 + ONLINE_WINDOW_MS + 1)).toBe(0)
  })

  it('keeps a device online when an old one re-pings after newer ones', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', 0)
    s.touch('device-bbbb', 10_000)
    s.touch('device-aaaa', 100_000) // re-ping moves it to newest
    expect(s.count(10_000 + ONLINE_WINDOW_MS + 1)).toBe(1)
  })
})

describe('isValidDeviceId', () => {
  it('accepts UUIDs and the dev_ fallback, rejects junk', () => {
    expect(isValidDeviceId('3f2b8c1e-9a4d-4e5f-8b6c-1d2e3f4a5b6c')).toBe(true)
    expect(isValidDeviceId('dev_k3j4h5g6l7m8')).toBe(true)
    expect(isValidDeviceId('')).toBe(false)
    expect(isValidDeviceId('short')).toBe(false)
    expect(isValidDeviceId('x'.repeat(65))).toBe(false)
    expect(isValidDeviceId('bad id with spaces')).toBe(false)
    expect(isValidDeviceId(42)).toBe(false)
  })
})
