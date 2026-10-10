import type { MatchEntry, MatchPlayer } from '@/lib/types'
import type { Lang } from '@/lib/i18n'
import type { DeviceOs } from './user-agent'

export interface PlayerFollow {
  kind: 'player'
  /** Upper-case GUID. */
  tournamentId: string
  /** BAT's tournament-local player id. */
  playerId: string
  /** As shown when followed, for the list. */
  playerName: string
  addedAt: string
}

export interface ClubFollow {
  kind: 'club'
  /** Upper-case GUID. */
  tournamentId: string
  /** As BAT prints it in this tournament. */
  clubName: string
  addedAt: string
}

export type PushFollow = PlayerFollow | ClubFollow

/** What a follow or unfollow request names. */
export type FollowTarget =
  | { kind: 'player'; tournamentId: string; playerId: string; playerName?: string }
  | { kind: 'club'; tournamentId: string; clubName: string }

export interface PushKeys {
  p256dh: string
  auth: string
}

export interface PushSubscriptionRecord {
  /** The push service address; the record's key. */
  endpoint: string
  keys: PushKeys
  lang: Lang
  follows: PushFollow[]
  createdAt: string
  /** Refreshed whenever the device talks to the API. */
  lastSeenAt: string
  /** One coarse word for the device's operating system, for the status page.
   *  Absent on a device last seen before this was kept. Never the user agent
   *  itself: see lib/push/user-agent.ts. */
  os?: DeviceOs
}

/** `soon` and `next` come before a match; `result` once it has a winner. */
export type Stage = 'soon' | 'next' | 'result'

export interface DueAlert {
  endpoint: string
  lang: Lang
  stage: Stage
  /** 1-based place in the queue when decided; 0 for a result. */
  position: number
  sentKey: string
  /** Every sent key this alert settles: its own, plus `soon` when it is `next`. */
  covers: string[]
  match: MatchEntry
  /** The players in the match this device follows, directly or through a club. */
  players: MatchPlayer[]
  /** Of those, the ones followed by name. A club member the device does not
   *  also follow individually is not here, so the two reasons stay apart. */
  directPlayers: MatchPlayer[]
  /** The followed clubs that brought the match in. */
  clubs: string[]
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}
