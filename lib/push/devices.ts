import { createHash } from 'node:crypto'
import type { Lang } from '@/lib/i18n'
import type { PushSubscriptionRecord } from './types'
import type { DeviceOs } from './user-agent'

// What the status page shows about the devices following a match alert. The
// endpoint and its keys never leave the server: a device is named by a short
// hash of its endpoint, the same one the sent log keys use, so a row here can
// be matched against `[push]` log lines.

/** Enough devices to read; the store holds up to MAX_DEVICES. */
export const MAX_DEVICE_ROWS = 50

export interface DeviceFollowRow {
  kind: 'player' | 'club'
  /** The player or club as it was named when followed. */
  name: string
  /** Players only: BAT's tournament-local id. */
  playerId?: string
  tournamentId: string
  /** The tournament's name, or the start of its id when it is not listed. */
  tournamentName: string
  addedAt: string
}

export interface DeviceRow {
  /** First 16 hex of the endpoint's SHA-256. */
  id: string
  /** The browser behind the push service, or the service's hostname. */
  service: string
  /** The device's operating system, or '' for one last seen before it was kept. */
  os: DeviceOs
  lang: Lang
  createdAt: string
  lastSeenAt: string
  follows: DeviceFollowRow[]
}

/** How a device is named everywhere outside the store. */
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
}

/** The browser a push service speaks for; its hostname when unknown. */
function service(endpoint: string): string {
  const host = new URL(endpoint).hostname
  if (host === 'fcm.googleapis.com') return 'Chrome'
  if (host === 'web.push.apple.com') return 'Safari'
  if (host.endsWith('notify.windows.com')) return 'Edge'
  if (host.endsWith('push.services.mozilla.com')) return 'Firefox'
  return host
}

function followRow(
  follow: PushSubscriptionRecord['follows'][number],
  tournamentName: (id: string) => string | null,
): DeviceFollowRow {
  const row = {
    kind: follow.kind,
    name: follow.kind === 'player' ? follow.playerName : follow.clubName,
    tournamentId: follow.tournamentId,
    tournamentName: tournamentName(follow.tournamentId) ?? follow.tournamentId.slice(0, 8),
    addedAt: follow.addedAt,
  }
  return follow.kind === 'player' ? { ...row, playerId: follow.playerId } : row
}

/** The devices to show, most recently seen first, and how many there are. */
export function deviceRows(
  records: PushSubscriptionRecord[],
  tournamentName: (id: string) => string | null,
  limit: number = MAX_DEVICE_ROWS,
): { devices: DeviceRow[]; total: number } {
  const devices = [...records]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit)
    .map((r) => ({
      id: endpointHash(r.endpoint),
      service: service(r.endpoint),
      os: r.os ?? '',
      lang: r.lang,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      follows: r.follows.map((f) => followRow(f, tournamentName)),
    }))
  return { devices, total: records.length }
}
