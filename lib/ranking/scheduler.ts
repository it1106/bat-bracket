// Parameterized weekly-ranking poll scheduler. Each provider passes its
// own PollSchedule (BAT=Tuesday window, BWF=Wednesday window) so the same
// decision functions service both.
//
// Upstream cadence: each upstream publishes a new ranking once a week at
// no fixed time. So:
//   * On non-publish-day, the tick is a no-op.
//   * On publish-day within the polling window we do a *cheap* peek at
//     the overview page (a single HTTP call, no per-category fan-out) and
//     only trigger the expensive full refresh if the parsed publishDate
//     differs from the cached one.
//   * Outside the polling window we sit idle even on publish-day.

import type { BangkokClock } from '@/lib/today'
import type { PollSchedule } from './config'

export type SchedulerAction = 'skip' | 'peek-and-maybe-refresh'

export interface SchedulerInputs {
  clock: BangkokClock
  schedule: PollSchedule
}

export interface BootKickInputs extends SchedulerInputs {
  /** Time since the cache was written, in ms. Pass `null` when there is no
   *  cache at all (cold server) — that should always kick. */
  cacheAgeMs: number | null
}

export function decideTick({ clock, schedule }: SchedulerInputs): SchedulerAction {
  if (clock.dayOfWeek !== schedule.dayOfWeek) return 'skip'
  if (clock.hour < schedule.startHour) return 'skip'
  if (clock.hour > schedule.endHour) return 'skip'
  return 'peek-and-maybe-refresh'
}

/** Boot kick: when the server first comes up, fire an immediate peek if
 *  (a) today is publish-day in Bangkok inside the polling window, or
 *  (b) the cache is older than schedule.staleBootKickMs, or
 *  (c) the cache is missing entirely (cold server). */
export function decideBootKick(inputs: BootKickInputs): SchedulerAction {
  if (decideTick(inputs) === 'peek-and-maybe-refresh') return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs === null) return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs > inputs.schedule.staleBootKickMs) return 'peek-and-maybe-refresh'
  return 'skip'
}

export function publishDateChanged(cached: string | null, upstream: string): boolean {
  if (!upstream) return false
  return (cached ?? '').trim() !== upstream.trim()
}
