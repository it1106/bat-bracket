// How many alerts went out today, for the status page. In memory only: a
// restart starts the day's count again, which is all the page needs.
let day = ''
let counts = { sentToday: 0, failedToday: 0, goneToday: 0 }

function roll(dayIso: string): void {
  if (day === dayIso) return
  day = dayIso
  counts = { sentToday: 0, failedToday: 0, goneToday: 0 }
}

export function recordPush(result: 'ok' | 'gone' | 'failed', dayIso: string): void {
  roll(dayIso)
  if (result === 'ok') counts.sentToday++
  else if (result === 'gone') counts.goneToday++
  else counts.failedToday++
}

export function getPushStats(dayIso: string): { sentToday: number; failedToday: number; goneToday: number } {
  roll(dayIso)
  return { ...counts }
}
