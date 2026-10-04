// How long BAT takes to answer, over the past 60 minutes, for /bmstats. A
// rising slow end is the first sign BAT is struggling or throttling us, before
// requests start to fail. Memory-only: it is a rolling hour, so a restart
// just starts it again.

const WINDOW_MS = 60 * 60_000
/** A request this slow is one a visitor would have noticed waiting for. */
export const SLOW_MS = 5000

export interface LatencyStats {
  count: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
  /** Requests slower than SLOW_MS. */
  slow: number
}

export class LatencyWindow {
  private samples: Array<[number, number]> = [] // [time, ms], oldest first

  constructor(private maxSamples = 5000) {}

  add(ms: number, now: number): void {
    this.samples.push([now, ms])
    if (this.samples.length > this.maxSamples) this.samples.shift()
  }

  stats(now: number): LatencyStats {
    const cutoff = now - WINDOW_MS
    while (this.samples.length > 0 && this.samples[0][0] < cutoff) this.samples.shift()
    const sorted = this.samples.map(([, ms]) => ms).sort((a, b) => a - b)
    const n = sorted.length
    if (n === 0) return { count: 0, medianMs: null, p95Ms: null, maxMs: null, slow: 0 }
    const at = (p: number) => sorted[Math.max(0, Math.ceil(p * n) - 1)]
    return {
      count: n,
      medianMs: at(0.5),
      p95Ms: at(0.95),
      maxMs: sorted[n - 1],
      slow: sorted.filter((ms) => ms > SLOW_MS).length,
    }
  }
}

// On globalThis so instrumentation and the API routes share one window.
const g = globalThis as typeof globalThis & { __batLatency?: LatencyWindow }
const shared = g.__batLatency ??= new LatencyWindow()

export function recordBatLatency(ms: number): void {
  shared.add(ms, Date.now())
}

export function getBatLatency(): LatencyStats {
  return shared.stats(Date.now())
}
