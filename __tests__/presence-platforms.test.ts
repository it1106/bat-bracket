import { PresenceStore, UNKNOWN_PLATFORM } from '@/lib/presence'

// Noon in Bangkok on 2 Oct 2026.
const NOON = Date.UTC(2026, 9, 2, 5)
const DAY = 86_400_000

describe("today's users by device", () => {
  it('counts each device once, under the platform it was first seen on', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH', 'iOS')
    s.touch('device-aaaa', NOON + 1000, 'TH', 'iOS')
    s.touch('device-bbbb', NOON + 2000, 'TH', 'iOS')
    s.touch('device-cccc', NOON + 3000, 'US', 'Windows')
    // The same visitor on another browser: still one user, still iOS.
    s.touch('device-aaaa', NOON + 4000, 'TH', 'Android')
    expect(s.usersByPlatform(NOON + 5000)).toEqual([
      { platform: 'iOS', count: 2 },
      { platform: 'Windows', count: 1 },
    ])
    expect(s.users(NOON + 5000)).toBe(3)
  })

  it('counts a device as unknown until a heartbeat names its platform', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON)
    s.touch('device-bbbb', NOON, 'TH')
    expect(s.usersByPlatform(NOON)).toEqual([{ platform: UNKNOWN_PLATFORM, count: 2 }])
    s.touch('device-aaaa', NOON + 1000, 'TH', 'macOS')
    expect(s.usersByPlatform(NOON + 1000)).toEqual([
      { platform: 'macOS', count: 1 },
      { platform: UNKNOWN_PLATFORM, count: 1 },
    ])
  })

  it('ignores a platform that is not one of our words', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH', 'Symbian')
    s.touch('device-bbbb', NOON, 'TH', '<script>')
    expect(s.usersByPlatform(NOON)).toEqual([{ platform: UNKNOWN_PLATFORM, count: 2 }])
  })

  // Unknown sits last in the donut, not here: lib/platformDonut re-sorts.
  it('sorts the busiest first, ties by name', () => {
    const s = new PresenceStore()
    for (const id of ['aaaa', 'bbbb', 'cccc']) s.touch(`device-${id}`, NOON)
    s.touch('device-dddd', NOON, 'TH', 'iOS')
    expect(s.usersByPlatform(NOON)).toEqual([
      { platform: UNKNOWN_PLATFORM, count: 3 },
      { platform: 'iOS', count: 1 },
    ])
  })

  it('starts the count again on a new day', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH', 'iOS')
    expect(s.usersByPlatform(NOON + DAY)).toEqual([])
  })

  it('round-trips platforms through a snapshot', () => {
    const a = new PresenceStore()
    a.touch('device-aaaa', NOON, 'TH', 'Android')
    a.touch('device-bbbb', NOON, 'US', 'Windows')
    const b = new PresenceStore()
    b.restore(a.snapshot(NOON), NOON)
    expect(b.usersByPlatform(NOON)).toEqual(a.usersByPlatform(NOON))
  })

  it('restores a snapshot saved before platforms were kept, then fills them in', () => {
    const s = new PresenceStore()
    s.restore({ day: '2026-10-02', peak: { count: 2, at: NOON }, ids: ['device-aaaa', 'device-bbbb'] }, NOON)
    expect(s.usersByPlatform(NOON)).toEqual([{ platform: UNKNOWN_PLATFORM, count: 2 }])
    s.touch('device-aaaa', NOON, 'TH', 'iOS')
    expect(s.usersByPlatform(NOON)).toEqual([
      { platform: 'iOS', count: 1 },
      { platform: UNKNOWN_PLATFORM, count: 1 },
    ])
  })

  it('does not take junk platforms out of a snapshot', () => {
    const s = new PresenceStore()
    s.restore({
      day: '2026-10-02',
      peak: { count: 2, at: NOON },
      ids: ['device-aaaa', 'device-bbbb'],
      platforms: ['<script>', 7 as unknown as string],
    }, NOON)
    expect(s.usersByPlatform(NOON)).toEqual([{ platform: UNKNOWN_PLATFORM, count: 2 }])
  })

  it('names the platform of each device online now', () => {
    const s = new PresenceStore()
    s.touch('device-aaaa', NOON, 'TH', 'iPadOS')
    s.touch('device-bbbb', NOON + 1000, 'TH')
    expect(s.online(NOON + 2000)).toEqual([
      { id: 'device-bbbb', lastSeen: NOON + 1000, platform: '' },
      { id: 'device-aaaa', lastSeen: NOON, platform: 'iPadOS' },
    ])
  })

  it('still names the platform of a device restored from a snapshot', () => {
    const a = new PresenceStore()
    a.touch('device-aaaa', NOON, 'TH', 'Android')
    const b = new PresenceStore()
    b.restore(a.snapshot(NOON), NOON)
    // Restored devices are not online until they ping again.
    expect(b.online(NOON)).toEqual([])
    b.touch('device-aaaa', NOON + 1000)
    expect(b.online(NOON + 1000)).toEqual([{ id: 'device-aaaa', lastSeen: NOON + 1000, platform: 'Android' }])
  })
})
