import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'

// Why the worker restarted today, for /bmstats. The app only knows that it
// started; the reason is in PM2's own log, so this reads it. Server-only, and
// returns null wherever there is no PM2 (local runs).

export type RestartReason = 'reload' | 'memory' | 'crash'

export interface RestartInfo {
  /** Times the worker started today. */
  starts: number
  /** Deploys and manual reloads. */
  reloads: number
  /** Restarted by PM2 for passing the memory limit. */
  memory: number
  /** The process died on its own. */
  crashes: number
  /** The most recent start: local time as PM2 logged it, and why. */
  last: { at: string; reason: RestartReason } | null
  /** Every start today, oldest first. */
  events: RestartEvent[]
}

export interface RestartEvent {
  /** Local time as PM2 logged it, "YYYY-MM-DDTHH:MM:SS". */
  at: string
  reason: RestartReason
  /** What PM2 recorded about it: memory used against the limit, or the
   *  signal and exit code of a crash. Empty for a reload. */
  detail: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Reads one day's restarts of one app out of PM2's log text. */
export function parseRestarts(log: string, day: string, appName: string): RestartInfo {
  const app = escape(appName)
  const started = new RegExp(`App \\[${app}:\\d+\\] starting`)
  // A reload stops the previous worker as "_old_N"; a worker that exits under
  // its own id died on its own.
  const died = new RegExp(`App \\[${app}:\\d+\\] exited with code`)
  const info: RestartInfo = { starts: 0, reloads: 0, memory: 0, crashes: 0, last: null, events: [] }
  const megabytes = (bytes: string) => Math.round(Number(bytes) / (1024 * 1024))
  let pending: { reason: RestartReason; detail: string } | null = null
  for (const line of log.split('\n')) {
    if (!line.startsWith(day)) continue
    if (line.includes('exceeds --max-memory-restart')) {
      const m = line.match(/current_memory=(\d+) max_memory_limit=(\d+)/)
      pending = { reason: 'memory', detail: m ? `used ${megabytes(m[1])} MB, limit ${megabytes(m[2])} MB` : '' }
    } else if (died.test(line)) {
      const m = line.match(/exited with code \[(\d+)\] via signal \[(\w+)\]/)
      pending = { reason: 'crash', detail: m ? `signal ${m[2]}, exit code ${m[1]}` : '' }
    } else if (started.test(line)) {
      const { reason, detail } = pending ?? { reason: 'reload' as const, detail: '' }
      pending = null
      info.starts++
      if (reason === 'memory') info.memory++
      else if (reason === 'crash') info.crashes++
      else info.reloads++
      const at = line.slice(0, 19)
      info.last = { at, reason }
      info.events.push({ at, reason, detail })
    }
  }
  return info
}

export interface Pm2Settings {
  /** PM2's home directory, where pm2.log lives. */
  home: string
  /** This app's name in PM2. */
  name: string
  /** Bytes at which PM2 restarts the worker, or null if no limit is set. */
  memoryLimit: number | null
}

/** What PM2 told this worker about itself, or null when not running under
 *  PM2. PM2 starts a worker with one JSON variable, `pm2_env`, then spreads
 *  its fields into the environment as individual variables and deletes the
 *  original — so the worker normally sees `name`, `pm_id` and
 *  `max_memory_restart` directly. */
export function pm2Settings(env: Record<string, string | undefined>): Pm2Settings | null {
  const home = env.PM2_HOME
  if (!home) return null
  let name: string | undefined
  let limit: unknown
  if (env.pm_id !== undefined) {
    name = env.name
    limit = env.max_memory_restart
  } else if (env.pm2_env) {
    try {
      const parsed = JSON.parse(env.pm2_env) as { name?: string; max_memory_restart?: unknown }
      name = parsed.name
      limit = parsed.max_memory_restart
    } catch { /* not PM2's JSON */ }
  }
  if (!name) return null
  const bytes = Number(limit)
  return { home, name, memoryLimit: limit !== undefined && bytes > 0 ? bytes : null }
}

/** The memory limit PM2 restarts this worker at, in bytes, if it has one. */
export function memoryLimitBytes(): number | null {
  return pm2Settings(process.env)?.memoryLimit ?? null
}

// The log is small, but only its tail is needed and it grows for ever.
const TAIL_BYTES = 512 * 1024

export function getRestartInfo(): RestartInfo | null {
  const pm2 = pm2Settings(process.env)
  if (!pm2) return null
  try {
    const file = path.join(pm2.home, 'pm2.log')
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, 'r')
    try {
      const length = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, size - length)
      return parseRestarts(buf.toString('utf8'), dayOf(Date.now()), pm2.name)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}
