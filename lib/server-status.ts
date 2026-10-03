import { promises as fs } from 'fs'
import os from 'os'

// Host and worker figures for the /bmstats status page. Server-only.

export interface ServerStatus {
  cpu: { percent: number; cores: number; load: [number, number, number] }
  memory: { totalBytes: number; usedBytes: number }
  disk: { totalBytes: number; usedBytes: number } | null
  worker: {
    pid: number
    node: string
    startedAt: string
    uptimeSeconds: number
    rssBytes: number
    peakRssBytes: number
    heapUsedBytes: number
  }
}

function cpuTimes(): { busy: number; total: number } {
  let busy = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const t = cpu.times
    busy += t.user + t.nice + t.sys + t.irq
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { busy, total }
}

/** Share of CPU time spent busy across all cores, 0–100, between two samples. */
export function cpuPercent(
  before: { busy: number; total: number },
  after: { busy: number; total: number },
): number {
  const total = after.total - before.total
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, ((after.busy - before.busy) / total) * 100))
}

// os.freemem() counts page cache as used on some kernels; MemAvailable is the
// figure that says how much is actually left.
async function availableMemoryBytes(): Promise<number> {
  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf8')
    const kb = meminfo.match(/^MemAvailable:\s+(\d+) kB/m)
    if (kb) return Number(kb[1]) * 1024
  } catch { /* not Linux */ }
  return os.freemem()
}

const CPU_SAMPLE_MS = 250

export async function getServerStatus(): Promise<ServerStatus> {
  const before = cpuTimes()
  const [available, disk] = await Promise.all([
    availableMemoryBytes(),
    fs.statfs(process.cwd()).catch(() => null),
    new Promise((r) => setTimeout(r, CPU_SAMPLE_MS)),
  ])
  const total = os.totalmem()
  const mem = process.memoryUsage()
  return {
    cpu: {
      percent: cpuPercent(before, cpuTimes()),
      cores: os.cpus().length,
      load: os.loadavg() as [number, number, number],
    },
    memory: { totalBytes: total, usedBytes: Math.max(0, total - available) },
    disk: disk && {
      totalBytes: disk.blocks * disk.bsize,
      usedBytes: (disk.blocks - disk.bavail) * disk.bsize,
    },
    worker: {
      pid: process.pid,
      node: process.version,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: mem.rss,
      // maxRSS is reported in kilobytes.
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      heapUsedBytes: mem.heapUsed,
    },
  }
}
