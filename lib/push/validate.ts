import type { FollowTarget, PushKeys } from './types'

// The server sends a request to whatever address a subscription names, so
// only the push services browsers actually use are accepted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/]

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname))
  } catch {
    return false
  }
}

export function isGuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** Base64 or URL-safe base64 as bytes; null when it is neither. */
function decodeKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(value)) return null
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

const short = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

export function parseSubscription(value: unknown): { endpoint: string; keys: PushKeys } | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (!isPushEndpoint(v.endpoint) || !v.keys) return null
  if (!short(v.keys.p256dh, 200) || !short(v.keys.auth, 200)) return null
  // What a browser hands over: an uncompressed P-256 point (65 bytes, first
  // one 0x04) and a 16-byte secret. Anything else could never be sent to, and
  // would sit in the store for good.
  const point = decodeKey(v.keys.p256dh)
  const secret = decodeKey(v.keys.auth)
  if (!point || point.length !== 65 || point[0] !== 4 || !secret || secret.length !== 16) return null
  return { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** A follow or unfollow target, with the tournament id upper-cased and names
 *  tidied. Following a player needs the name to show in the list. */
export function parseTarget(value: unknown, forFollow: boolean): FollowTarget | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!isGuid(v.tournamentId)) return null
  const tournamentId = v.tournamentId.toUpperCase()
  if (v.kind === 'player') {
    if (typeof v.playerId !== 'string' || !/^\d{1,12}$/.test(v.playerId)) return null
    if (typeof v.playerName === 'string' && v.playerName.length <= 120 && tidy(v.playerName)) {
      return { kind: 'player', tournamentId, playerId: v.playerId, playerName: tidy(v.playerName) }
    }
    if (v.playerName !== undefined || forFollow) return null
    return { kind: 'player', tournamentId, playerId: v.playerId }
  }
  if (v.kind === 'club') {
    if (typeof v.clubName !== 'string' || v.clubName.length > 120 || !tidy(v.clubName)) return null
    return { kind: 'club', tournamentId, clubName: tidy(v.clubName) }
  }
  return null
}
