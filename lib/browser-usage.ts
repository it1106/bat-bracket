import { promises as fs } from 'fs'

// CPU and memory used by the headless browser the BWF provider drives, for
// /bmstats. It runs as separate processes, so none of it shows in the worker's
// own figures. Linux only (reads /proc); elsewhere it reports nothing.

export interface ProcStat { comm: string; ticks: number; rssPages: number }

/** Parses one /proc/<pid>/stat line. The name sits in brackets and may itself
 *  contain spaces or brackets, so split on the last ")". */
export function parseProcStat(line: string): ProcStat | null {
  const open = line.indexOf('(')
  const close = line.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const rest = line.slice(close + 2).split(' ')
  // Fields after the name start at field 3 (state): utime is 14, stime 15, rss 24.
  const utime = Number(rest[11])
  const stime = Number(rest[12])
  const rss = Number(rest[21])
  if (![utime, stime, rss].every(Number.isFinite)) return null
  return { comm: line.slice(open + 1, close), ticks: utime + stime, rssPages: rss }
}

const isBrowser = (comm: string) => /^(chrome|chromium|headless_shell)/i.test(comm)

export function sumBrowser(procs: ProcStat[]): { processes: number; ticks: number; rssPages: number } {
  const browser = procs.filter((p) => isBrowser(p.comm))
  return {
    processes: browser.length,
    ticks: browser.reduce((sum, p) => sum + p.ticks, 0),
    rssPages: browser.reduce((sum, p) => sum + p.rssPages, 0),
  }
}

async function snapshot(): Promise<{ processes: number; ticks: number; rssPages: number } | null> {
  try {
    const pids = (await fs.readdir('/proc')).filter((name) => /^\d+$/.test(name))
    const stats = await Promise.all(
      pids.map((pid) => fs.readFile(`/proc/${pid}/stat`, 'utf8').then(parseProcStat, () => null)),
    )
    return sumBrowser(stats.filter((s): s is ProcStat => s !== null))
  } catch {
    return null
  }
}

const TICKS_PER_SECOND = 100
const PAGE_BYTES = 4096

export interface BrowserUsage {
  processes: number
  /** Resident memory summed over its processes. Shared pages are counted once
   *  per process, so this overstates a little. */
  rssBytes: number
  /** Share of one CPU core used over the sample, 0–100 per core. */
  cpuPercent: number
}

/** Samples the browser over `sampleMs`. Null where /proc is not available. */
export async function getBrowserUsage(sampleMs: number): Promise<BrowserUsage | null> {
  const before = await snapshot()
  if (!before) return null
  const started = Date.now()
  await new Promise((r) => setTimeout(r, sampleMs))
  const after = await snapshot()
  if (!after) return null
  const seconds = Math.max(0.05, (Date.now() - started) / 1000)
  return {
    processes: after.processes,
    rssBytes: after.rssPages * PAGE_BYTES,
    cpuPercent: Math.max(0, ((after.ticks - before.ticks) / TICKS_PER_SECOND / seconds) * 100),
  }
}
