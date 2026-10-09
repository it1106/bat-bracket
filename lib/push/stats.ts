// How many alerts went out today, for the status page. In memory only: a
// restart starts the day's count again, which is all the page needs.
//
// Kept on globalThis: Next builds the watcher (instrumentation) and the status
// route as separate copies of this module, and the route must read what the
// watcher recorded. The same reason as lib/bat-fetch-stats.ts.
interface PushStatsState {
  day: string
  counts: { sentToday: number; failedToday: number; goneToday: number }
}

const g = globalThis as typeof globalThis & { __batmatchPushStats?: PushStatsState }
const state: PushStatsState = (g.__batmatchPushStats ??= { day: '', counts: { sentToday: 0, failedToday: 0, goneToday: 0 } })

function roll(dayIso: string): void {
  if (state.day === dayIso) return
  state.day = dayIso
  state.counts = { sentToday: 0, failedToday: 0, goneToday: 0 }
}

export function recordPush(result: 'ok' | 'gone' | 'failed', dayIso: string): void {
  roll(dayIso)
  if (result === 'ok') state.counts.sentToday++
  else if (result === 'gone') state.counts.goneToday++
  else state.counts.failedToday++
}

export function getPushStats(dayIso: string): { sentToday: number; failedToday: number; goneToday: number } {
  roll(dayIso)
  return { ...state.counts }
}
