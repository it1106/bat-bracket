// Returns today's date as YYYY-MM-DD in the given timezone.
// Default is Asia/Bangkok because BAT publishes match-day dates in Thai
// local time, and a server in UTC (or a client browser in any other zone)
// would otherwise compare those local dates against a UTC "today" — making
// every check off by up to a day during the 7-hour Bangkok/UTC offset.
export function getTodayIso(timeZone = 'Asia/Bangkok'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

export function getBangkokHour(now: Date = new Date(), timeZone = 'Asia/Bangkok'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hourPart = parts.find((p) => p.type === 'hour')
  if (!hourPart) return 0
  const h = parseInt(hourPart.value, 10)
  // Some locales emit '24' for midnight; normalize to 0.
  return h === 24 ? 0 : h
}

/**
 * A frozen snapshot of Bangkok wall-clock time. Pure schedulers take this
 * as input so they can be unit-tested without mocking `Date`.
 */
export interface BangkokClock {
  dayOfWeek: number // 0=Sun..6=Sat
  hour: number      // 0..23
  minute: number    // 0..59
}

export function getBangkokClock(now: Date = new Date(), timeZone = 'Asia/Bangkok'): BangkokClock {
  return {
    dayOfWeek: getBangkokDayOfWeek(now, timeZone),
    hour: getBangkokHour(now, timeZone),
    minute: getBangkokMinute(now, timeZone),
  }
}

// Returns minutes-of-hour (0..59) in the given timezone. Pairs with
// getBangkokHour() to gate a tick on a sub-hour window without rolling our
// own offset math. Keeping it in this module (rather than instrumentation)
// makes the day-boundary behavior testable without touching the scheduler.
export function getBangkokMinute(now: Date = new Date(), timeZone = 'Asia/Bangkok'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const minutePart = parts.find((p) => p.type === 'minute')
  if (!minutePart) return 0
  return parseInt(minutePart.value, 10)
}

// Day-of-week in the given timezone. 0 = Sunday … 6 = Saturday, matching
// JavaScript's Date.prototype.getDay() so the rest of the codebase can keep
// using familiar constants (TUESDAY === 2).
export function getBangkokDayOfWeek(now: Date = new Date(), timeZone = 'Asia/Bangkok'): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(now)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekday] ?? 0
}
