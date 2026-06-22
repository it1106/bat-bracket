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
  /** Time since the overview cache was written, in ms. When older than
   *  schedule.staleBootKickMs we peek even off the weekly publish window:
   *  an upstream can revise a *published* edition in place (backfilling
   *  late-processed results) without bumping its publish date, and only a
   *  peek can discover that. Omit/null to disable the off-window safety net. */
  cacheAgeMs?: number | null
}

export interface BootKickInputs extends SchedulerInputs {
  /** Time since the cache was written, in ms. Pass `null` when there is no
   *  cache at all (cold server) — that should always kick. */
  cacheAgeMs: number | null
}

export function decideTick({ clock, schedule, cacheAgeMs }: SchedulerInputs): SchedulerAction {
  const inWindow =
    clock.dayOfWeek === schedule.dayOfWeek &&
    clock.hour >= schedule.startHour &&
    clock.hour <= schedule.endHour
  if (inWindow) return 'peek-and-maybe-refresh'
  // Off-window safety net: a cache this old may have missed an in-place
  // revision of the current edition, so peek to find out.
  if (cacheAgeMs != null && cacheAgeMs > schedule.staleBootKickMs) return 'peek-and-maybe-refresh'
  return 'skip'
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

/** Decide whether a cheap peek should escalate to a full per-category
 *  refresh. True when the upstream publishDate changed (a new edition) OR
 *  the cache is older than `revisionTtlMs` — the safety net for an upstream
 *  that revises a published edition in place without bumping its date. A
 *  null `cacheAgeMs` (cold cache) leaves only the publishDate signal. */
export function shouldRefresh(
  cachedPublishDate: string | null,
  upstreamPublishDate: string,
  cacheAgeMs: number | null,
  revisionTtlMs: number,
): boolean {
  if (publishDateChanged(cachedPublishDate, upstreamPublishDate)) return true
  return cacheAgeMs != null && cacheAgeMs > revisionTtlMs
}
