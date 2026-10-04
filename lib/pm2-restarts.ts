import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'

// Why the worker restarted today, for /bmstats. The app only knows that it
// started; the reason is in PM2's own log, so this reads it. Server-only, and
// returns null wherever there is no PM2 (local runs, Vercel).

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
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Reads one day's restarts of one app out of PM2's log text. */
export function parseRestarts(log: string, day: string, appName: string): RestartInfo {
  const app = escape(appName)
  const started = new RegExp(`App \\[${app}:\\d+\\] starting`)
  // A reload stops the previous worker as "_old_N"; a worker that exits under
  // its own id died on its own.
  const died = new RegExp(`App \\[${app}:\\d+\\] exited with code`)
  const info: RestartInfo = { starts: 0, reloads: 0, memory: 0, crashes: 0, last: null }
  let pending: RestartReason | null = null
  for (const line of log.split('\n')) {
    if (!line.startsWith(day)) continue
    if (line.includes('exceeds --max-memory-restart')) pending = 'memory'
    else if (died.test(line)) pending = 'crash'
    else if (started.test(line)) {
      const reason = pending ?? 'reload'
      pending = null
      info.starts++
      if (reason === 'memory') info.memory++
      else if (reason === 'crash') info.crashes++
      else info.reloads++
      info.last = { at: line.slice(0, 19), reason }
    }
  }
  return info
}

interface Pm2Env { name?: string; max_memory_restart?: number }

function pm2Env(): Pm2Env | null {
  try {
    return process.env.pm2_env ? (JSON.parse(process.env.pm2_env) as Pm2Env) : null
  } catch {
    return null
  }
}

/** The memory limit PM2 restarts this worker at, in bytes, if it has one. */
export function memoryLimitBytes(): number | null {
  const limit = pm2Env()?.max_memory_restart
  return typeof limit === 'number' && limit > 0 ? limit : null
}

// The log is small, but only its tail is needed and it grows for ever.
const TAIL_BYTES = 512 * 1024

export function getRestartInfo(): RestartInfo | null {
  const home = process.env.PM2_HOME
  const name = pm2Env()?.name
  if (!home || !name) return null
  try {
    const file = path.join(home, 'pm2.log')
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, 'r')
    try {
      const length = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, size - length)
      return parseRestarts(buf.toString('utf8'), dayOf(Date.now()), name)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}
