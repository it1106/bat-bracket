// The BAT outage history as a log of moments: one entry when BAT went down
// and one when it came back, newest first. Pure, for the /bmstats page.

export interface OutageSpan {
  start: string
  end: string | null
  detail: string
}

export interface OutageEvent {
  /** ISO time of the moment. */
  at: string
  type: 'down' | 'up'
  /** down: what the failure was ("HTTP 500"). up: '' */
  detail: string
  /** up: how long BAT had been down, in seconds. down: null */
  downSeconds: number | null
}

export function outageEvents(outages: OutageSpan[]): OutageEvent[] {
  const events: OutageEvent[] = []
  for (const outage of outages) {
    events.push({ at: outage.start, type: 'down', detail: outage.detail, downSeconds: null })
    if (outage.end === null) continue
    const downSeconds = Math.max(0, Math.round((Date.parse(outage.end) - Date.parse(outage.start)) / 1000))
    events.push({ at: outage.end, type: 'up', detail: '', downSeconds })
  }
  // Newest first; at the same instant "up" reads after "down".
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.type === 'up' ? -1 : 1))
}
