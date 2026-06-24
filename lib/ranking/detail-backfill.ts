import type { RankingPlayerDetail } from '@/lib/types'

export interface BackfillResult {
  total: number
  have: number     // ready before this run (skipped)
  fetched: number  // newly fetched or resolved-as-notFound this run
  failed: string[]
}

export interface BackfillDeps {
  fetchDetail: (gid: string) => Promise<RankingPlayerDetail | { notFound: true }>
  isReady: (gid: string) => Promise<boolean>
  persistNotFound: (gid: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  delayMs?: number          // base pace between fetches (default 2000)
  jitterMs?: number         // +/- jitter (default 500)
  breakerThreshold?: number // consecutive failures before aborting (default 5)
}

export class BackfillBusyError extends Error {
  constructor() { super('detail backfill already running'); this.name = 'BackfillBusyError' }
}

let running = false

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runDetailBackfill(
  gids: string[],
  deps: BackfillDeps,
): Promise<BackfillResult> {
  if (running) throw new BackfillBusyError()
  running = true
  try {
    const sleep = deps.sleep ?? defaultSleep
    const delayMs = deps.delayMs ?? 2000
    const jitterMs = deps.jitterMs ?? 500
    const breakerThreshold = deps.breakerThreshold ?? 5

    let have = 0
    let fetched = 0
    let consecutiveFailures = 0
    const failed: string[] = []

    for (const gid of gids) {
      if (await deps.isReady(gid)) { have++; continue }
      try {
        const out = await deps.fetchDetail(gid)
        if ('notFound' in out) await deps.persistNotFound(gid)
        fetched++
        consecutiveFailures = 0
      } catch {
        failed.push(gid)
        consecutiveFailures++
        if (consecutiveFailures >= breakerThreshold) break
      }
      const jitter = (Math.random() * 2 - 1) * jitterMs
      await sleep(Math.max(0, delayMs + jitter))
    }
    return { total: gids.length, have, fetched, failed }
  } finally {
    running = false
  }
}
