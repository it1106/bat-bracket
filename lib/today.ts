// Returns today's date as YYYY-MM-DD in the given timezone.
// Default is Asia/Bangkok because BAT publishes match-day dates in Thai
// local time, and a server in UTC (or a client browser in any other zone)
// would otherwise compare those local dates against a UTC "today" — making
// every check off by up to a day during the 7-hour Bangkok/UTC offset.
export function getTodayIso(timeZone = 'Asia/Bangkok'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}
