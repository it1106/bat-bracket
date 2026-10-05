import fs from 'fs'
import path from 'path'
import { dayOf } from './presence'
import { sharedCounter } from './bat-fetch-stats'
import { routeOf } from './site-requests'

// Who asked this server for what: one line per request in
// .cache/access-log/<day>.log, so a question like "what did this address do?"
// or "who set off that burst?" is a grep away. Also counts today's site
// requests by the visitor's country, for the donut on /bmstats.
//
// Cloudflare puts the visitor's address and country on every request it passes
// on (CF-Connecting-IP, CF-IPCountry). A request without them did not come
// through Cloudflare — the LAN address, or the server asking itself.
//
// An address is personal data: files are kept RETENTION_DAYS and then deleted,
// and lib/privacy.ts says so. Fed by the HTTP hook in lib/request-timer; like
// the timings there, it only observes and must never affect a request.

export const RETENTION_DAYS = 14
const MAX_URL = 300
const MAX_TEXT = 200
/** Lines waiting to be written beyond this are dropped rather than held in memory. */
const MAX_BUFFERED_BYTES = 1_000_000

/** The country of a request that did not come through Cloudflare. */
export const DIRECT = 'direct'

type Headers = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? ''
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)

/** The visitor's address and country, as Cloudflare reported them. */
export function clientOf(headers: Headers, socketAddress: string | undefined): { ip: string; country: string } {
  const cfIp = first(headers['cf-connecting-ip']).trim()
  const cfCountry = first(headers['cf-ipcountry']).trim().toUpperCase()
  const viaCloudflare = /^[0-9a-fA-F:.]{3,45}$/.test(cfIp)
  return {
    ip: viaCloudflare ? cfIp : (socketAddress ?? '').replace(/^::ffff:/, '') || '-',
    // Two characters: a country code, or Cloudflare's XX (unknown) and T1 (Tor).
    country: viaCloudflare && /^[A-Z0-9]{2}$/.test(cfCountry) ? cfCountry : viaCloudflare ? 'XX' : DIRECT,
  }
}

/** The URL as logged: bounded, and without what a visitor typed into a search
 *  box (`q=`), which the privacy notice says is not recorded. */
export function loggedUrl(url: string | undefined): string {
  return clip((url ?? '').replace(/([?&]q=)[^&]*/g, '$1-'), MAX_URL)
}

export interface AccessEntry {
  now: number
  ip: string
  country: string
  method: string
  url: string | undefined
  /** The status sent, or 0 when the visitor went away before an answer. */
  status: number
  ms: number
  userAgent: string
  referer: string
}

/** One line of the log: JSON, so a hostile URL or user agent cannot forge or
 *  break lines. */
export function accessLine(e: AccessEntry): string {
  return JSON.stringify({
    t: new Date(e.now).toISOString(),
    ip: e.ip,
    cc: e.country,
    m: clip(e.method, 10),
    s: e.status,
    ms: Math.round(e.ms),
    url: loggedUrl(e.url),
    ua: clip(e.userAgent, MAX_TEXT),
    ref: clip(e.referer, MAX_TEXT),
  })
}

/** The day files in `names` older than the retention period. */
export function expiredLogs(names: string[], now: number, retentionDays = RETENTION_DAYS): string[] {
  const oldest = dayOf(now - (retentionDays - 1) * 86_400_000)
  return names.filter((name) => /^\d{4}-\d{2}-\d{2}\.log$/.test(name) && name.slice(0, 10) < oldest)
}

/** Appends lines to one file per Bangkok day, and deletes the expired ones
 *  whenever the day changes (and when the process starts). */
export class AccessLog {
  private day = ''
  private stream: fs.WriteStream | null = null
  private warned = false

  constructor(private dir: string, private retentionDays = RETENTION_DAYS) {}

  write(line: string, now: number): void {
    const day = dayOf(now)
    if (day !== this.day) this.open(day, now)
    if (!this.stream || this.stream.writableLength > MAX_BUFFERED_BYTES) return
    this.stream.write(line + '\n')
  }

  /** Closes the current file; resolves once everything written is on disk. */
  close(): Promise<void> {
    const stream = this.stream
    this.stream = null
    this.day = ''
    return new Promise((resolve) => (stream ? stream.end(resolve) : resolve()))
  }

  private open(day: string, now: number): void {
    this.stream?.end()
    this.stream = null
    this.day = day
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      for (const name of expiredLogs(fs.readdirSync(this.dir), now, this.retentionDays)) {
        fs.rmSync(path.join(this.dir, name), { force: true })
      }
      const stream = fs.createWriteStream(path.join(this.dir, `${day}.log`), { flags: 'a' })
      // A full disk or a vanished folder: stop writing until the next day.
      stream.on('error', (err) => {
        if (this.stream === stream) this.stream = null
        this.warn(err)
      })
      this.stream = stream
    } catch (err) {
      this.warn(err)
    }
  }

  private warn(err: unknown): void {
    if (this.warned) return
    this.warned = true
    console.log(`[access-log] not writing: ${err instanceof Error ? err.message : 'unknown'}`)
  }
}

// On globalThis for the same reason as the counters in lib/site-requests.
const g = globalThis as typeof globalThis & { __accessLog?: AccessLog }
// Tests exercise AccessLog directly, so a test run never writes into this repo.
const log = process.env.NODE_ENV === 'test'
  ? null
  : (g.__accessLog ??= new AccessLog(path.join(process.cwd(), '.cache', 'access-log')))
const countries = sharedCounter('__siteCountryStats', 'site-country-stats.json', { countStarts: false })

// Build files: thousands of requests that say nothing about what a visitor did.
const UNLOGGED = /^\/_next\/static\//

/** Called by the HTTP hook when a request ends, answered or not. */
export function recordAccess(e: AccessEntry): void {
  // The same requests the "Site requests" figures count, so the totals agree.
  if (e.status > 0 && routeOf(e.url)) countries.record(e.country, true)
  if (log && !UNLOGGED.test(e.url ?? '')) log.write(accessLine(e), e.now)
}

/** Today's site requests by country, busiest first. */
export function getCountryStats(): Array<{ country: string; count: number }> {
  return countries.stats().byKind
    .map(({ kind, count }) => ({ country: kind, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
}
