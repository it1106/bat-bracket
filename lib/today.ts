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
