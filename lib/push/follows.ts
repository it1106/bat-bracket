import { nameToSlug } from '@/lib/playerIndex'
import type { AlertTier, PushFollow } from './types'

// The two questions every reader of a stored follow has to ask, in one place:
// how wide is it, and how much does it send. Both have to answer for records
// written before either existed, so neither reads a field directly.

/** The cross-tournament player key: the slug `/player/bat/<slug>`, the player
 *  index and the profile link all use, so a follow made from the bell matches
 *  the same person the rest of the site shows. Re-exported here so the one
 *  rule lives in one place for both the browser and the watcher. */
export const followSlug = (playerName: string): string => nameToSlug(playerName)

/** Whether this follow goes wherever the player plays. A player follow that
 *  names no tournament is one; anything else, club follows included, is not. */
export function isEverywhere(follow: PushFollow): boolean {
  return follow.kind === 'player' && !follow.tournamentId && !!follow.slug
}

/** What this follow asks to be told. A club is followed for its members'
 *  results and has never brought anything earlier, so it is always `result`
 *  whatever is stored on it. A player follow with no tier is one made before
 *  tiers, which got everything. */
export function tierOf(follow: PushFollow): AlertTier {
  if (follow.kind === 'club') return 'result'
  return follow.tier === 'result' ? 'result' : 'full'
}

/** The wider of two tiers. A device that follows the same player twice — in
 *  this tournament for the results, everywhere for everything — is asking for
 *  everything, and must not be cut back to the narrower of its two answers. */
export function widerTier(a: AlertTier, b: AlertTier): AlertTier {
  return a === 'full' || b === 'full' ? 'full' : 'result'
}
