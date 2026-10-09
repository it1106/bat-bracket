'use client'

// The /bmstats status page: host CPU, memory and disk, the worker process,
// requests to the BAT server (today and the past 60 minutes) and visitors.
// Polls /api/bmstats; all times are shown in Bangkok time. The figures need a
// logged-in session, so a 401 from the API swaps the page for the login form.

import { useCallback, useEffect, useState } from 'react'
import { setSearchAliases } from '@/lib/searchAliases'
import { outageEvents } from '@/lib/batOutageEvents'
import CountryDonut from '@/components/CountryDonut'
import { useTheme } from '@/lib/ThemeContext'

const REFRESH_MS = 10_000

interface Status {
  generatedAt: string
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
    heapLimitBytes?: number
  }
  bat: {
    day: string
    today: number
    failedToday: number
    startsToday: number
    byKind: Array<{ kind: string; count: number }>
    lastHour: number
    perMinute: number[]
  }
  pages?: {
    day: string
    today: number
    byKind: Array<{ kind: string; count: number }>
    lastHour: number
    perMinute: number[]
  }
  highs?: Partial<Record<HighKey, { value: number; at: string }>>
  history?: Array<{ day: string; users?: number; peak?: number; pages?: number; site?: number; bat?: number; batFailed?: number }>
  latency?: { count: number; medianMs: number | null; p95Ms: number | null; maxMs: number | null; slow: number }
  restarts?: {
    starts: number
    reloads: number
    memory: number
    crashes: number
    last: { at: string; reason: 'reload' | 'memory' | 'crash' } | null
    events?: Array<{ at: string; reason: 'reload' | 'memory' | 'crash'; detail: string }>
  } | null
  memoryLimitBytes?: number | null
  playerCache?: { writesToday: number; failedToday: number }
  push?: { sentToday: number; failedToday: number; goneToday: number }
  site?: {
    count: number
    medianMs: number | null
    p95Ms: number | null
    slow: number
    errors: number
    today: number
    errorsToday: number
    byRoute: Array<{ route: string; today?: number; count: number; medianMs: number | null; p95Ms: number | null; errors: number }>
    countries?: Array<{ country: string; count: number }>
  }
  browser?: { processes: number; rssBytes: number; cpuPercent: number } | null
  bwf?: { today: number; failedToday: number; lastHour: number }
  outages?: {
    since: string | null
    current: { start: string; kind: OutageKind; detail: string; failed: number } | null
    recent: Array<{ start: string; end: string | null; kind: OutageKind; detail: string; failed: number }>
    downMinutes: Record<string, number>
  }
  diskEntries?: Array<{ name: string; bytes: number }>
  visitors: {
    online: number
    peak: number
    peakAt: string | null
    users: number
    countries?: Array<{ country: string; count: number }>
    onlineIds?: Array<{ id: string; lastSeenAt: string }>
  }
}

type HighKey = 'batDay' | 'batHour' | 'batFailedDay' | 'pagesDay' | 'pagesHour' | 'peakOnline' | 'usersDay' | 'diskUsed'

const num = (n: number) => n.toLocaleString('en-US')

/** "3 Oct 2026", or "3 Oct 2026, 16:52" for figures reached at a moment. */
function dateOf(iso: string, withTime: boolean): string {
  const date = new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
  })
  return withTime ? `${date}, ${clock(iso)}` : date
}

/** "Mon 5 Oct 2026, 00:42:13" in Bangkok time. */
function fullTime(iso: string): string {
  const weekday = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', weekday: 'short' })
  return `${weekday} ${dateOf(iso, false)}, ${clock(iso, true)}`
}

/** The Bangkok calendar day (YYYY-MM-DD) of a moment. */
function dayOfBangkok(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

function bytes(n: number): string {
  const gb = n / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
}

/** "850 ms" or "2.1 s". */
function millis(ms: number | null): string {
  if (ms === null) return '–'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

type OutageKind = 'error' | 'blocked' | 'unreachable'
// What each kind of BAT outage looked like from here.
const OUTAGE_LABEL: Record<OutageKind, string> = {
  error: 'BAT answered with errors',
  blocked: 'BAT refused our requests',
  unreachable: 'No answer from BAT',
}

const RESTART_REASON = { reload: 'deploy or reload', memory: 'memory limit', crash: 'crash' } as const
// What each kind of start is called in the list of today's starts, and what
// it means. A planned one reads green; one nobody asked for reads red.
const RESTART_LABEL = {
  reload: { title: 'Planned restart', meaning: 'a deploy or a manual reload' },
  memory: { title: 'Memory limit', meaning: 'PM2 replaced the worker for using too much memory' },
  crash: { title: 'Crash', meaning: 'the worker stopped on its own' },
} as const

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return m > 0 ? `${m}m` : `${seconds}s`
}

function clock(iso: string | number, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds && { second: '2-digit' }),
  })
}

function ago(nowIso: string, thenIso: string): string {
  const seconds = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(thenIso).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`
}

// Status is carried by the word, not only the colour.
function level(percent: number): { label: string; color: string } {
  if (percent >= 90) return { label: 'Critical', color: 'var(--red)' }
  if (percent >= 75) return { label: 'High', color: 'var(--track-fg)' }
  return { label: 'OK', color: 'var(--win-fg)' }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bms-card">
      <h2 className="bms-card-title">{title}</h2>
      {children}
    </section>
  )
}

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const { label: state, color } = level(percent)
  return (
    <div className="bms-meter">
      <div className="bms-meter-head">
        <span className="bms-meter-label">{label}</span>
        <span className="bms-meter-state">
          <span className="bms-dot" style={{ background: color }} aria-hidden="true" />
          {state}
        </span>
      </div>
      <div className="bms-meter-value">{Math.round(percent)}%</div>
      <div
        className="bms-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="bms-fill" style={{ width: `${Math.min(100, percent)}%`, background: color }} />
      </div>
      <div className="bms-note">{detail}</div>
    </div>
  )
}

function Tile({ label, value, note, high, highWithTime = false }: {
  label: string
  value: string
  note?: string
  /** The all-time high for this figure, if one has been recorded. */
  high?: { value: number; at: string }
  highWithTime?: boolean
}) {
  return (
    <div className="bms-tile">
      <div className="bms-tile-label">{label}</div>
      <div className="bms-tile-value">{value}</div>
      {note && <div className="bms-note">{note}</div>}
      {high && (
        <div className="bms-high">
          All-time high <b>{num(high.value)}</b> · {dateOf(high.at, highWithTime)}
        </div>
      )}
    </div>
  )
}

function MinuteChart({ perMinute, generatedAt, noun, label }: {
  perMinute: number[]
  generatedAt: string
  /** What one unit is, singular: "request", "page load". */
  noun: string
  /** What the chart shows, for screen readers. */
  label: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...perMinute)
  const end = new Date(generatedAt).getTime()
  const minuteAt = (i: number) => clock(end - (perMinute.length - 1 - i) * 60_000)
  const peakIndex = perMinute.indexOf(Math.max(...perMinute))
  const readout = hovered === null
    ? `Busiest minute: ${num(perMinute[peakIndex])} at ${minuteAt(peakIndex)}`
    : `${minuteAt(hovered)} — ${num(perMinute[hovered])} ${noun}${perMinute[hovered] === 1 ? '' : 's'}`
  return (
    <div>
      <div className="bms-chart-readout" aria-live="off">{readout}</div>
      <div
        className="bms-chart"
        role="img"
        aria-label={`${label} per minute over the past 60 minutes. ${readout}.`}
        onMouseLeave={() => setHovered(null)}
      >
        <span className="bms-chart-max">{num(max)}</span>
        {perMinute.map((n, i) => (
          <div
            key={i}
            className={`bms-col${hovered === i ? ' bms-col--on' : ''}`}
            onMouseEnter={() => setHovered(i)}
            onClick={() => setHovered(i)}
          >
            <div className="bms-bar" style={{ height: n === 0 ? 0 : `max(2px, ${(n / max) * 100}%)` }} />
          </div>
        ))}
      </div>
      <div className="bms-chart-axis">
        <span>{minuteAt(0)}</span>
        <span>{minuteAt(Math.floor(perMinute.length / 2))}</span>
        <span>{minuteAt(perMinute.length - 1)}</span>
      </div>
    </div>
  )
}

// Short names visitors can type in the search box, each standing for a longer
// name: typing "ren" also finds "รวิณ". Saved on the server; every visitor's
// search picks the list up on their next page load.
function AliasEditor() {
  const [aliases, setAliases] = useState<Record<string, string> | null>(null)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = async (res: Response) => {
    const data = (await res.json().catch(() => null)) as { aliases?: Record<string, string>; error?: string } | null
    if (res.ok && data?.aliases) {
      setAliases(data.aliases)
      setSearchAliases(data.aliases)
      setError(null)
      return true
    }
    setError(data?.error ?? 'Could not save. Try again.')
    return false
  }

  useEffect(() => {
    fetch('/api/bmstats/aliases', { cache: 'no-store' }).then(apply).catch(() => setError('Could not load the aliases.'))
  }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/bmstats/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (await apply(res)) {
        setKey('')
        setValue('')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (k: string) => {
    if (busy) return
    setBusy(true)
    try {
      await apply(await fetch(`/api/bmstats/aliases?key=${encodeURIComponent(k)}`, { method: 'DELETE' }))
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const rows = aliases ? Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b)) : []
  return (
    <Card title="Search aliases">
      <p className="bms-note">
        Typing the short name in the search box also finds the full name. Typing just the first letters works too
        (2 or more). Changes reach visitors the next time they load the page.
      </p>
      {aliases && (
        rows.length === 0 ? (
          <p className="bms-note">No aliases yet.</p>
        ) : (
          <table className="bms-table bms-alias-table">
            <thead>
              <tr>
                <th scope="col" className="bms-th">Short name</th>
                <th scope="col" className="bms-th">Finds</th>
                <td />
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td className="bms-alias-value">{v}</td>
                  <td>
                    <button type="button" className="bms-logout" disabled={busy} onClick={() => remove(k)} aria-label={`Remove ${k}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <form className="bms-alias-form" onSubmit={add}>
        <input
          className="bms-login-input"
          aria-label="Short name"
          placeholder="Short name, e.g. ren"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <span className="bms-alias-arrow" aria-hidden="true">→</span>
        <input
          className="bms-login-input"
          aria-label="Full name it finds"
          placeholder="Finds, e.g. รวิณ"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="bms-login-button" type="submit" disabled={busy || !key.trim() || !value.trim()}>
          Add
        </button>
      </form>
      {error && <p className="bms-login-error" role="alert">{error}</p>}
    </Card>
  )
}

// Light/dark switch, shared with the rest of the site (same saved choice).
// Both icons are rendered and CSS shows the right one, so the button is
// correct before React hydrates.
export function BmStatsThemeToggle() {
  const { toggleTheme } = useTheme()
  return (
    <button
      type="button"
      className="bms-logout bms-theme"
      onClick={toggleTheme}
      aria-label="Switch between light and dark mode"
      title="Light / dark mode"
    >
      <span className="bms-theme-to-dark" aria-hidden="true">🌙</span>
      <span className="bms-theme-to-light" aria-hidden="true">☀</span>
    </button>
  )
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/bmstats/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        onLoggedIn()
        return
      }
      setError(
        res.status === 401 ? 'Wrong password.'
          : res.status === 429 ? 'Too many wrong attempts. Wait a minute and try again.'
          : res.status === 503 ? 'No password has been set on the server.'
          : 'Could not log in. Try again.',
      )
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="bms-card bms-login" onSubmit={submit}>
      <h1 className="bms-title">Server status</h1>
      <label className="bms-login-label" htmlFor="bms-password">Password</label>
      <input
        id="bms-password"
        className="bms-login-input"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="bms-login-error" role="alert">{error}</p>}
      <button className="bms-login-button" type="submit" disabled={busy || password.length === 0}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  )
}

export default function BmStats() {
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bmstats', { cache: 'no-store' })
      if (res.status === 401) {
        setNeedsLogin(true)
        setStatus(null)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      setStatus((await res.json()) as Status)
      setNeedsLogin(false)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (needsLogin) return
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, needsLogin])

  const logout = async () => {
    await fetch('/api/bmstats/logout', { method: 'POST' }).catch(() => {})
    setStatus(null)
    setNeedsLogin(true)
  }

  if (needsLogin) return <LoginForm onLoggedIn={() => setNeedsLogin(false)} />

  if (!status) {
    return <p className="bms-note" role="status">{failed ? 'Could not load the server status.' : 'Loading…'}</p>
  }

  const { cpu, memory, disk, worker, bat, pages, visitors, latency, restarts, playerCache } = status
  const highs = status.highs ?? {}
  const history = status.history ?? []
  const { site, browser, bwf, outages } = status
  const nowMs = new Date(status.generatedAt).getTime()
  const lasted = (start: string, end: string | null) =>
    duration(Math.max(0, Math.round(((end ? new Date(end).getTime() : nowMs) - new Date(start).getTime()) / 1000)))
  // A day gets a down-time figure only from the day tracking began.
  const downOn = (day: string): number | undefined =>
    outages?.since && day >= dayOfBangkok(outages.since) ? outages.downMinutes[day] ?? 0 : undefined
  const diskEntries = status.diskEntries ?? []
  const memoryLimit = status.memoryLimitBytes ?? null
  return (
    <div className="bms">
      <header className="bms-header">
        <div className="bms-header-row">
          <h1 className="bms-title">Server status</h1>
          <button type="button" className="bms-logout" onClick={logout}>Log out</button>
        </div>
        <p className="bms-note" role="status">
          {failed
            ? `Not responding — showing figures from ${clock(status.generatedAt, true)}`
            : `Updated ${clock(status.generatedAt, true)} · refreshes every ${REFRESH_MS / 1000}s · Bangkok time`}
        </p>
      </header>

      <Card title="Server">
        <div className="bms-grid">
          <Meter
            label="CPU"
            percent={cpu.percent}
            detail={`${cpu.cores} core${cpu.cores === 1 ? '' : 's'} · load ${cpu.load.map((l) => l.toFixed(2)).join(' / ')}`}
          />
          <Meter
            label="Memory"
            percent={(memory.usedBytes / memory.totalBytes) * 100}
            detail={`${bytes(memory.usedBytes)} of ${bytes(memory.totalBytes)} used`}
          />
          {disk && (
            <Meter
              label="Disk"
              percent={(disk.usedBytes / disk.totalBytes) * 100}
              detail={`${bytes(disk.usedBytes)} of ${bytes(disk.totalBytes)} used`}
            />
          )}
        </div>
        {disk && diskEntries.length > 0 && (
          <>
            <h3 className="bms-subtitle">What is using the disk</h3>
            <table className="bms-table">
              <tbody>
                {diskEntries.map(({ name, bytes: size }) => (
                  <tr key={name}>
                    <th scope="row" className="bms-path">{name}</th>
                    <td>{bytes(size)}</td>
                    <td className="bms-share">{Math.round((size / disk.usedBytes) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="bms-note">
              The app&apos;s folders and PM2&apos;s logs; the rest of the disk is the operating system. Percentages are of
              the space in use. Measured every ten minutes.
              {highs.diskUsed && ` Most ever used: ${bytes(highs.diskUsed.value)} on ${dateOf(highs.diskUsed.at, false)}.`}
            </p>
          </>
        )}
      </Card>

      {site && (
        <Card title="Site requests">
          <p className="bms-note">
            What visitors&apos; pages ask this server for: schedules, brackets, players and so on. This is how fast the
            site feels to them. Heartbeats and this page are left out.
          </p>
          <div className="bms-grid">
            <Tile label="Past 60 minutes" value={num(site.count)} note={`${num(site.today)} today`} />
            <Tile label="Typical" value={millis(site.medianMs)} note="half of requests were faster" />
            <Tile label="Slowest 5%" value={millis(site.p95Ms)} note={`${num(site.slow)} took over 3 seconds`} />
            <Tile label="Errors" value={num(site.errors)} note={`${num(site.errorsToday)} today · server errors only`} />
          </div>
          {site.byRoute.length > 0 && (
            <>
              <h3 className="bms-subtitle">By type</h3>
              <div className="bms-scroll">
                <table className="bms-table bms-routes">
                  <thead>
                    <tr>
                      <th scope="col" className="bms-th">Request</th>
                      <td className="bms-th">Today</td>
                      <td className="bms-th">Past 60 min</td>
                      <td className="bms-th">Typical</td>
                      <td className="bms-th">Slowest 5%</td>
                      <td className="bms-th">Errors</td>
                    </tr>
                  </thead>
                  <tbody>
                    {site.byRoute.map((r) => (
                      <tr key={r.route}>
                        <th scope="row">{r.route}</th>
                        <td>{r.today === undefined ? '–' : num(r.today)}</td>
                        <td>{num(r.count)}</td>
                        <td>{millis(r.medianMs)}</td>
                        <td>{millis(r.p95Ms)}</td>
                        <td>{num(r.errors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="bms-note">
                Today is midnight to midnight, {bat.day}. Typical, slowest 5% and errors are for the past 60 minutes.
              </p>
            </>
          )}
          {site.countries && site.countries.length > 0 && (
            <>
              <h3 className="bms-subtitle">By country</h3>
              <CountryDonut countries={site.countries} />
              <p className="bms-note">
                Where today&apos;s requests came from, as Cloudflare reports each visitor&apos;s country. Every request
                is also written to the access log with its address, kept for 14 days.
              </p>
            </>
          )}
        </Card>
      )}

      <Card title="Requests to BAT">
        {outages && (
          <div className="bms-flag" role="status">
            <span className="bms-meter-state">
              <span
                className="bms-dot"
                style={{ background: outages.current ? 'var(--red)' : 'var(--win-fg)' }}
                aria-hidden="true"
              />
              {outages.current ? 'Down' : 'OK'}
            </span>
            <span>
              {outages.current ? (
                <>
                  BAT has been down since <b>{clock(outages.current.start)}</b> ({lasted(outages.current.start, null)}).
                  {' '}{OUTAGE_LABEL[outages.current.kind]} ({outages.current.detail});
                  {' '}<b>{num(outages.current.failed)}</b> requests have failed. Visitors are seeing saved copies.
                </>
              ) : (
                <>BAT is answering.{outages.recent[0]?.end
                  ? ` Last outage ended ${dateOf(outages.recent[0].end, true)}.`
                  : ' No outage on record.'}</>
              )}
            </span>
          </div>
        )}
        <div className="bms-grid">
          <Tile label="Today" value={num(bat.today)} note={`since midnight, ${bat.day}`} high={highs.batDay} />
          <Tile label="Past 60 minutes" value={num(bat.lastHour)} note={`${num(bat.perMinute[bat.perMinute.length - 1])} in the current minute`} high={highs.batHour} highWithTime />
          <Tile label="Failed today" value={num(bat.failedToday)} note="errors and non-200 responses" high={highs.batFailedDay} />
        </div>
        {latency && (
          <>
            <h3 className="bms-subtitle">How fast BAT answered, past 60 minutes</h3>
            <div className="bms-grid">
              <Tile label="Typical" value={millis(latency.medianMs)} note="half of requests were faster" />
              <Tile label="Slowest 5%" value={millis(latency.p95Ms)} note={`slowest ${millis(latency.maxMs)}`} />
              <Tile
                label="Over 5 seconds"
                value={num(latency.slow)}
                note={`of ${num(latency.count)} request${latency.count === 1 ? '' : 's'}`}
              />
            </div>
          </>
        )}
        {playerCache && (
          <div className="bms-flag">
            <span className="bms-meter-state">
              <span
                className="bms-dot"
                style={{ background: playerCache.failedToday === 0 ? 'var(--win-fg)' : 'var(--red)' }}
                aria-hidden="true"
              />
              {playerCache.failedToday === 0 ? 'OK' : 'Problem'}
            </span>
            <span>
              Player cache failures today: <b>{num(playerCache.failedToday)}</b> of {num(playerCache.writesToday)} saves.
              {playerCache.failedToday === 0
                ? ' It should stay at 0.'
                : ' Players are not being remembered, so they are fetched from BAT again.'}
            </span>
          </div>
        )}
        <h3 className="bms-subtitle">Per minute, past 60 minutes</h3>
        <MinuteChart perMinute={bat.perMinute} generatedAt={status.generatedAt} noun="request" label="Requests to BAT" />
        <h3 className="bms-subtitle">Today by type</h3>
        {bat.byKind.length === 0 ? (
          <p className="bms-note">No requests yet today.</p>
        ) : (
          <table className="bms-table">
            <tbody>
              {bat.byKind.map(({ kind, count }) => (
                <tr key={kind}>
                  <th scope="row">{kind}</th>
                  <td>{num(count)}</td>
                  <td className="bms-share">{Math.round((count / bat.today) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {status.push && (
        <Card title="Match alerts">
          <p className="bms-note">
            Sent today: <b>{num(status.push.sentToday)}</b> · failed: <b>{num(status.push.failedToday)}</b> · devices
            removed as gone: <b>{num(status.push.goneToday)}</b>.
          </p>
        </Card>
      )}

      {outages && (
        <Card title="BAT outages">
          {outages.recent.length === 0 ? (
            <p className="bms-note">
              None recorded{outages.since ? ` since tracking began on ${dateOf(outages.since, true)}` : ''}.
            </p>
          ) : (
            <div className="bms-scroll">
              <table className="bms-table bms-history">
                <thead>
                  <tr>
                    <th scope="col" className="bms-th">Started</th>
                    <td className="bms-th">Ended</td>
                    <td className="bms-th">Lasted</td>
                    <td className="bms-th">Failed requests</td>
                    <td className="bms-th">What happened</td>
                  </tr>
                </thead>
                <tbody>
                  {outages.recent.map((outage) => (
                    <tr key={outage.start}>
                      <th scope="row">{dateOf(outage.start, true)}</th>
                      <td>{outage.end ? clock(outage.end) : <span className="bms-today">still down</span>}</td>
                      <td>{lasted(outage.start, outage.end)}</td>
                      <td>{num(outage.failed)}</td>
                      <td>{OUTAGE_LABEL[outage.kind]} ({outage.detail})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {outages.recent.length > 0 && (
            <>
              <h3 className="bms-subtitle">Event log</h3>
              <ul className="bms-events">
                {outageEvents(outages.recent).map((event) => (
                  <li key={`${event.type}${event.at}`}>
                    <time dateTime={event.at}>{fullTime(event.at)}</time>
                    <span className="bms-meter-state">
                      <span
                        className="bms-dot"
                        style={{ background: event.type === 'down' ? 'var(--red)' : 'var(--win-fg)' }}
                        aria-hidden="true"
                      />
                      {event.type === 'down' ? 'BAT went down' : 'BAT came back up'}
                    </span>
                    <span className="bms-events-note">
                      {event.type === 'down' ? event.detail : `after ${duration(event.downSeconds ?? 0)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="bms-note">
            An outage is five or more BAT requests failing in a row over at least 30 seconds; it ends at the first of
            three answers in a row. This is BAT as seen from this server, so a break in the server&apos;s own
            connection shows here too.
          </p>
        </Card>
      )}

      {pages && (
        <Card title="Page loads">
          <p className="bms-note">
            Each time a browser loads a page of the site. This is what PostHog calls a page view, so the two should be
            close. Moving between tournaments, days and tabs inside a page is not a page load.
          </p>
          <div className="bms-grid">
            <Tile label="Today" value={num(pages.today)} note={`since midnight, ${pages.day}`} high={highs.pagesDay} />
            <Tile label="Past 60 minutes" value={num(pages.lastHour)} note={`${num(pages.perMinute[pages.perMinute.length - 1])} in the current minute`} high={highs.pagesHour} highWithTime />
            <Tile
              label="Per user today"
              value={visitors.users > 0 ? (pages.today / visitors.users).toFixed(1) : '–'}
              note="page loads ÷ users today"
            />
          </div>
          <h3 className="bms-subtitle">Per minute, past 60 minutes</h3>
          <MinuteChart perMinute={pages.perMinute} generatedAt={status.generatedAt} noun="page load" label="Page loads" />
          <h3 className="bms-subtitle">Today by page</h3>
          {pages.byKind.length === 0 ? (
            <p className="bms-note">No page loads counted yet today.</p>
          ) : (
            <table className="bms-table">
              <tbody>
                {pages.byKind.map(({ kind, count }) => (
                  <tr key={kind}>
                    <th scope="row">{kind}</th>
                    <td>{num(count)}</td>
                    <td className="bms-share">{Math.round((count / pages.today) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card title="Worker">
        <div className="bms-grid">
          <Tile label="Uptime" value={duration(worker.uptimeSeconds)} note={`started ${clock(worker.startedAt)}`} />
          {memoryLimit ? (
            <Meter
              label="Memory against its limit"
              percent={(worker.rssBytes / memoryLimit) * 100}
              detail={`${bytes(worker.rssBytes)} of ${bytes(memoryLimit)} · peak ${bytes(worker.peakRssBytes)}`}
            />
          ) : (
            <Tile label="Memory" value={bytes(worker.rssBytes)} note={`peak ${bytes(worker.peakRssBytes)} · heap ${bytes(worker.heapUsedBytes)}`} />
          )}
        </div>
        <h3 className="bms-subtitle">Starts today</h3>
        {restarts ? (
          <>
            <div className="bms-grid">
              <Tile label="Deploys and reloads" value={num(restarts.reloads)} note="started on purpose" />
              <Tile label="Memory limit" value={num(restarts.memory)} note="restarted for using too much memory" />
              <Tile label="Crashes" value={num(restarts.crashes)} note="stopped on its own" />
            </div>
            <p className="bms-note">
              {restarts.last
                ? `Last start ${restarts.last.at.slice(11, 16)}: ${RESTART_REASON[restarts.last.reason]}.`
                : 'No starts today; the worker has been running since before midnight.'}
            </p>
            {restarts.events && restarts.events.length > 0 && (
              <ol className="bms-events" aria-label="Starts today, most recent first">
                {[...restarts.events].reverse().map((event, i) => (
                  <li key={`${event.at}-${i}`} className={`bms-event bms-event--${event.reason === 'reload' ? 'planned' : 'problem'}`}>
                    <span className="bms-event-time">{event.at.slice(11, 19)}</span>
                    <span className="bms-event-what">
                      <b>{RESTART_LABEL[event.reason].title}</b>
                      {' — '}
                      {RESTART_LABEL[event.reason].meaning}
                      {event.detail && ` (${event.detail})`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <div className="bms-grid">
            <Tile label="Starts today" value={num(bat.startsToday)} note="times the worker has started since midnight" />
          </div>
        )}
        <p className="bms-note">
          Node {worker.node} · pid {worker.pid}
          {worker.heapLimitBytes ? ` · heap ${bytes(worker.heapUsedBytes)} of a ${bytes(worker.heapLimitBytes)} ceiling` : ''}
        </p>
      </Card>

      {(browser || bwf) && (
        <Card title="BWF browser">
          <p className="bms-note">
            The headless browser the server runs to fetch BWF data. It is separate from the worker, so its memory and
            CPU are not in the Worker figures above.
          </p>
          {browser && (
            <div className="bms-grid">
              <Tile label="Memory" value={browser.processes > 0 ? bytes(browser.rssBytes) : '–'} note="added up over its processes" />
              <Tile label="CPU" value={browser.processes > 0 ? `${Math.round(browser.cpuPercent)}%` : '–'} note="of one core, right now" />
              <Tile label="Processes" value={num(browser.processes)} note={browser.processes === 0 ? 'not running' : 'running'} />
            </div>
          )}
          {bwf && (
            <>
              <h3 className="bms-subtitle">Requests to BWF</h3>
              <div className="bms-grid">
                <Tile label="Today" value={num(bwf.today)} />
                <Tile label="Past 60 minutes" value={num(bwf.lastHour)} />
                <Tile label="Failed today" value={num(bwf.failedToday)} />
              </div>
            </>
          )}
        </Card>
      )}

      <Card title="Visitors">
        <div className="bms-grid">
          <Tile label="Online now" value={num(visitors.online)} />
          <Tile label="Peak today" value={num(visitors.peak)} note={visitors.peakAt ? `at ${clock(visitors.peakAt)}` : undefined} high={highs.peakOnline} highWithTime />
          <Tile label="Users today" value={num(visitors.users)} high={highs.usersDay} />
        </div>
        <h3 className="bms-subtitle">Online now</h3>
        {!visitors.onlineIds || visitors.onlineIds.length === 0 ? (
          <p className="bms-note">Nobody online.</p>
        ) : (
          <>
            <table className="bms-table">
              <thead>
                <tr>
                  <th scope="col" className="bms-th">Visitor ID</th>
                  <td className="bms-th">Last seen</td>
                </tr>
              </thead>
              <tbody>
                {visitors.onlineIds.map(({ id, lastSeenAt }) => (
                  <tr key={id}>
                    <th scope="row" className="bms-id">{id}</th>
                    <td>{ago(status.generatedAt, lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visitors.onlineIds.length < visitors.online && (
              <p className="bms-note">Showing the {visitors.onlineIds.length} most recent of {num(visitors.online)}.</p>
            )}
            <p className="bms-note">
              The ID is the one each browser sends to PostHog. A visitor stays listed for two minutes after their last ping.
            </p>
          </>
        )}
      </Card>

      {history.length > 0 && (
        <Card title="Past 30 days">
          <div className="bms-scroll">
            <table className="bms-table bms-history">
              <thead>
                <tr>
                  <th scope="col" className="bms-th">Day</th>
                  <td className="bms-th">Users</td>
                  <td className="bms-th">Peak online</td>
                  <td className="bms-th">Page loads</td>
                  <td className="bms-th" title="Data requests the site answered (schedules, brackets, players…), midnight to midnight">Site requests</td>
                  <td className="bms-th">BAT requests</td>
                  <td className="bms-th">BAT failed</td>
                  <td className="bms-th">BAT down</td>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.day}>
                    <th scope="row">
                      {dateOf(`${row.day}T12:00:00+07:00`, false)}
                      {row.day === bat.day && <span className="bms-today"> so far</span>}
                    </th>
                    {([row.users, row.peak, row.pages, row.site, row.bat, row.batFailed] as const).map((value, i) => (
                      <td key={i}>{value === undefined ? '–' : num(value)}</td>
                    ))}
                    <td>{downOn(row.day) === undefined ? '–' : `${num(downOn(row.day) as number)} min`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="bms-note">A dash means that figure was not being counted on that day.</p>
          {visitors.countries && visitors.countries.length > 0 && (
            <>
              <h3 className="bms-subtitle">Today&apos;s users by country</h3>
              <CountryDonut countries={visitors.countries} noun="user" />
              <p className="bms-note">
                Each of today&apos;s {num(visitors.users)} users, by the country Cloudflare reported when they were
                first seen. Unknown is a user seen before their country was being recorded.
              </p>
            </>
          )}
        </Card>
      )}

      <AliasEditor />
    </div>
  )
}
