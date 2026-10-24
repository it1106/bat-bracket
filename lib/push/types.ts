import type { MatchEntry, MatchPlayer } from '@/lib/types'
import type { Lang } from '@/lib/i18n'
import type { DeviceOs } from './user-agent'

/** Which alerts a follow brings. `full` is the match coming up, going on
 *  court and its result; `result` is the published score alone. A follow
 *  stored before tiers existed has none, and is read as `full`. */
export type AlertTier = 'full' | 'result'

export interface PlayerFollow {
  kind: 'player'
  /** Upper-case GUID, or '' for a player followed in every tournament.
   *  Empty rather than absent so that every reader which upper-cases it goes
   *  on working — including the one in a deploy rolled back to before this. */
  tournamentId: string
  /** BAT's tournament-local player id, which means nothing outside the
   *  tournament it came from: '' on a follow that names no tournament. */
  playerId: string
  /** The site's own cross-tournament player key, `nameToSlug(playerName)` —
   *  the same one `/player/bat/<slug>` and the player index use. Only on a
   *  follow that names no tournament; it is what such a follow matches on. */
  slug?: string
  /** As shown when followed, for the list. */
  playerName: string
  addedAt: string
  /** Absent means `full`, which is what every follow was before tiers. */
  tier?: AlertTier
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

/** What a follow or unfollow request names. A player is named either in one
 *  tournament, by BAT's local id, or in every tournament, by the name key.
 *  A club is always one tournament's: the name is only BAT's within it. */
export type FollowTarget =
  | { kind: 'player'; scope?: 'tournament'; tournamentId: string; playerId: string; playerName?: string; tier?: AlertTier }
  | { kind: 'player'; scope: 'everywhere'; slug: string; playerName: string; tier?: AlertTier }
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
  /** This device asked to be told when something new is published on the
   *  site: a tournament, its draws, its schedule. Independent of follows —
   *  a device may have this on and follow nobody. Absent means off. */
  site?: boolean
}

/** `soon` comes before a match, `playing` once it is on court, `result` once
 *  it has a winner. The three publication kinds share the type because
 *  `RecentSend.stage` is typed from it. */
export type Stage = 'soon' | 'playing' | 'result' | PublicationKind

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

/** What a publication notification is about. */
export type PublicationKind = 'tournament' | 'bracket' | 'schedule'

/** One thing newly published, for every device with site news on. Not a
 *  `DueAlert`: there is no match behind it. */
export interface Publication {
  kind: PublicationKind
  /** Upper-case GUID. */
  tournamentId: string
  /** As the site lists it now, not as it was when first seen. */
  tournamentName: string
  /** Draw names for `bracket`, ISO dates for `schedule`, empty for `tournament`. */
  items: string[]
}
