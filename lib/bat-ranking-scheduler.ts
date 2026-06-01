// Decides what the periodic BAT-ranking tick should do **right now**, given
// the Bangkok wall-clock day/hour/minute and the publish-date currently on
// disk. The logic is split out of instrumentation.ts so it can be unit-tested
// without mocking timers, fs, or fetch.
//
// Upstream cadence: BAT publishes a new ranking once a week on Tuesdays at
// no fixed time. So:
//   * On non-Tuesday days, the tick is a no-op.
//   * On Tuesday within the polling window we do a *cheap* peek at the
//     overview page (a single HTTP call, no per-category fan-out) and only
//     trigger the expensive full refresh if the parsed publishDate differs
//     from the cached one. This catches the new edition the moment it lands
//     without hammering upstream the rest of the week.
//   * Outside the polling window we sit idle even on Tuesday — overnight
//     pulls are unnecessary and noisy.
//
// The two thresholds (TUE_POLL_START_HOUR, TUE_POLL_END_HOUR_INCLUSIVE) are
// expressed as inclusive ranges over Bangkok hours: a tick at hh:mm fires
// when `start <= hh <= endInclusive`. To match "08:00–23:30 BKK" we accept
// hours 8..23 and let the 30-minute setInterval cadence land both 23:00 and
// 23:30 inside the window.

import type { BangkokClock } from './today'

export const TUE = 2
export const TUE_POLL_START_HOUR = 8
export const TUE_POLL_END_HOUR_INCLUSIVE = 23
// If the cache is older than this, we know we've missed at least one
// publication window — peek immediately on boot regardless of day-of-week.
// Upstream cadence is 7 days, so 6 days gives a one-day safety margin.
export const STALE_BOOT_KICK_MS = 6 * 24 * 60 * 60 * 1000

export type SchedulerAction = 'skip' | 'peek-and-maybe-refresh'

export interface SchedulerInputs {
  clock: BangkokClock
}

export interface BootKickInputs extends SchedulerInputs {
  /**
   * Time since the cache was written, in ms. Pass `null` when there is no
   * cache at all (cold server) — that should always kick.
   */
  cacheAgeMs: number | null
}

export function decideTick(inputs: SchedulerInputs): SchedulerAction {
  const { clock } = inputs
  if (clock.dayOfWeek !== TUE) return 'skip'
  if (clock.hour < TUE_POLL_START_HOUR) return 'skip'
  if (clock.hour > TUE_POLL_END_HOUR_INCLUSIVE) return 'skip'
  return 'peek-and-maybe-refresh'
}

/**
 * Boot kick: when the server first comes up, fire an immediate peek if:
 *   - today is Tuesday in Bangkok and we're inside the polling window
 *     (a deploy during the publication window catches up without waiting
 *      for the first 30-minute tick), OR
 *   - the cache is older than STALE_BOOT_KICK_MS, meaning we've missed at
 *     least one weekly publish — could be because the server was down
 *     through last Tuesday, because the scheduler was just introduced
 *     (this very deploy), or because of an upstream outage. In all those
 *     cases we want to catch up now rather than wait for the next Tuesday.
 *
 * Returns the same SchedulerAction so the caller can fan into the same
 * peek-and-maybe-refresh code path either way.
 */
export function decideBootKick(inputs: BootKickInputs): SchedulerAction {
  if (decideTick(inputs) === 'peek-and-maybe-refresh') return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs === null) return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs > STALE_BOOT_KICK_MS) return 'peek-and-maybe-refresh'
  return 'skip'
}

/**
 * Treat the *cached* and *upstream* publishDate strings as equal only when
 * they match exactly after trimming. The BAT page renders them as e.g.
 * "19/5/2569"; we don't try to parse to a Date because the upstream string
 * is authoritative — if upstream changes its formatting we want to refresh,
 * not silently treat the new form as "same".
 */
export function publishDateChanged(cached: string | null, upstream: string): boolean {
  if (!upstream) return false // can't act on an empty parse
  return (cached ?? '').trim() !== upstream.trim()
}
