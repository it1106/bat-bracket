import { deviceRows, endpointHash, MAX_DEVICE_ROWS } from '@/lib/push/devices'
import type { PushFollow, PushSubscriptionRecord } from '@/lib/push/types'

const TID = '704595C5-4A11-4093-A254-6791021DF219'

function record(over: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord {
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'p256dh-secret', auth: 'auth-secret' },
    lang: 'en',
    follows: [],
    createdAt: '2026-10-09T02:00:00.000Z',
    lastSeenAt: '2026-10-09T03:00:00.000Z',
    ...over,
  }
}

const player = (over: Partial<PushFollow> = {}): PushFollow => ({
  kind: 'player',
  tournamentId: TID,
  playerId: '2588',
  playerName: 'ปริญญา พุฒิไพรสกุล',
  addedAt: '2026-10-09T03:21:36.386Z',
  ...over,
} as PushFollow)

const club = (over: Partial<PushFollow> = {}): PushFollow => ({
  kind: 'club',
  tournamentId: TID,
  clubName: 'UNITY&RAWIN',
  addedAt: '2026-10-09T03:24:06.219Z',
  ...over,
} as PushFollow)

const names = (id: string) => (id === TID ? 'LI-NING Pathumthani Championship' : null)

describe('endpointHash', () => {
  it('is the first 16 hex of the endpoint\'s SHA-256, so it matches the sent log and the server scripts', () => {
    expect(endpointHash('https://fcm.googleapis.com/fcm/send/abc123')).toBe('d395ac524dac9139')
  })

  it('tells two endpoints apart', () => {
    expect(endpointHash('https://a.example/1')).not.toBe(endpointHash('https://a.example/2'))
  })
})

describe('deviceRows', () => {
  it('names the browser behind each push service', () => {
    const hosts = [
      ['https://fcm.googleapis.com/fcm/send/x', 'Chrome'],
      ['https://web.push.apple.com/x', 'Safari'],
      ['https://wns2-sg2p.notify.windows.com/w/?token=x', 'Edge'],
      ['https://updates.push.services.mozilla.com/wpush/v2/x', 'Firefox'],
    ] as const
    const { devices } = deviceRows(hosts.map(([endpoint]) => record({ endpoint })), names)
    expect(devices.map((d) => d.service)).toEqual(hosts.map(([, label]) => label))
  })

  it('falls back to the hostname for a push service it does not know', () => {
    const { devices } = deviceRows([record({ endpoint: 'https://push.example.org/send/x' })], names)
    expect(devices[0].service).toBe('push.example.org')
  })

  it('lists a player follow with its id and tournament', () => {
    const { devices } = deviceRows([record({ follows: [player()] })], names)
    expect(devices[0].follows).toEqual([{
      kind: 'player',
      name: 'ปริญญา พุฒิไพรสกุล',
      playerId: '2588',
      tournamentId: TID,
      tournamentName: 'LI-NING Pathumthani Championship',
      addedAt: '2026-10-09T03:21:36.386Z',
    }])
  })

  it('lists a club follow with no player id', () => {
    const { devices } = deviceRows([record({ follows: [club()] })], names)
    expect(devices[0].follows).toEqual([{
      kind: 'club',
      name: 'UNITY&RAWIN',
      tournamentId: TID,
      tournamentName: 'LI-NING Pathumthani Championship',
      addedAt: '2026-10-09T03:24:06.219Z',
    }])
  })

  it('shows the start of the id when the tournament is not listed', () => {
    const follows = [player({ tournamentId: 'ABCDEF12-0000-0000-0000-000000000000' } as Partial<PushFollow>)]
    const { devices } = deviceRows([record({ follows })], names)
    expect(devices[0].follows[0].tournamentName).toBe('ABCDEF12')
  })

  it('puts the most recently seen device first', () => {
    const { devices } = deviceRows([
      record({ endpoint: 'https://a.example/old', lastSeenAt: '2026-10-09T01:00:00.000Z' }),
      record({ endpoint: 'https://a.example/new', lastSeenAt: '2026-10-09T05:00:00.000Z' }),
      record({ endpoint: 'https://a.example/mid', lastSeenAt: '2026-10-09T03:00:00.000Z' }),
    ], names)
    expect(devices.map((d) => d.id)).toEqual([
      endpointHash('https://a.example/new'),
      endpointHash('https://a.example/mid'),
      endpointHash('https://a.example/old'),
    ])
  })

  it('caps the rows but still reports how many devices there are', () => {
    const many = Array.from({ length: MAX_DEVICE_ROWS + 7 }, (_, i) =>
      record({ endpoint: `https://a.example/${i}` }))
    const { devices, total } = deviceRows(many, names)
    expect(devices).toHaveLength(MAX_DEVICE_ROWS)
    expect(total).toBe(MAX_DEVICE_ROWS + 7)
  })

  it('never carries the endpoint or the keys off the server', () => {
    const { devices } = deviceRows([record({ follows: [player(), club()] })], names)
    const json = JSON.stringify(devices)
    expect(json).not.toContain('fcm.googleapis.com/fcm/send/abc123')
    expect(json).not.toContain('p256dh-secret')
    expect(json).not.toContain('auth-secret')
    expect(Object.keys(devices[0])).not.toContain('endpoint')
    expect(Object.keys(devices[0])).not.toContain('keys')
  })
})
