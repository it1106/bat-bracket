import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

// What is using the disk, for /bmstats: the app's cache folders, its build
// and dependencies, and PM2's logs. Measured with `du`, which is slow enough
// on node_modules to be worth caching for a while.

export interface DiskEntry { name: string; bytes: number }

/** Parses `du -sk` output, largest first, naming paths relative to the app. */
export function parseDu(output: string, appDir: string): DiskEntry[] {
  const entries: DiskEntry[] = []
  for (const line of output.split('\n')) {
    const m = line.match(/^(\d+)\t(.+)$/)
    if (!m) continue
    const full = m[2]
    const name = full.startsWith(`${appDir}/`) ? full.slice(appDir.length + 1) : full
    entries.push({ name, bytes: Number(m[1]) * 1024 })
  }
  return entries.sort((a, b) => b.bytes - a.bytes)
}

const CACHE_MS = 10 * 60_000
let cached: { at: number; entries: DiskEntry[] } | null = null
let running: Promise<DiskEntry[]> | null = null

async function measure(): Promise<DiskEntry[]> {
  const app = process.cwd()
  const cacheDir = path.join(app, '.cache')
  const inCache = await fs.readdir(cacheDir).then((names) => names.map((n) => path.join(cacheDir, n)), () => [])
  const paths = [...inCache, path.join(app, '.next'), path.join(app, 'node_modules')]
  if (process.env.PM2_HOME) paths.push(path.join(process.env.PM2_HOME, 'logs'))
  const output = await new Promise<string>((resolve) => {
    // du exits non-zero if any path is missing; what it printed is still good.
    execFile('du', ['-sk', ...paths], { timeout: 20_000, maxBuffer: 1 << 20 }, (_err, stdout) => resolve(stdout ?? ''))
  })
  return parseDu(output, app)
}

/** The biggest folders and files, cached for ten minutes. */
export async function getDiskUsage(): Promise<DiskEntry[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.entries
  running ??= measure()
    .then((entries) => {
      cached = { at: Date.now(), entries }
      return entries
    })
    .catch(() => cached?.entries ?? [])
    .finally(() => { running = null })
  return running
}
