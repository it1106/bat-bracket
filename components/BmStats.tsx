'use client'

// The /bmstats status page: host CPU, memory and disk, the worker process,
// requests to the BAT server (today and the past 60 minutes) and visitors.
// Polls /api/bmstats; all times are shown in Bangkok time.

import { useEffect, useState } from 'react'

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
  visitors: { online: number; peak: number; peakAt: string | null; users: number }
}

const num = (n: number) => n.toLocaleString('en-US')

function bytes(n: number): string {
  const gb = n / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
}

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

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bms-tile">
      <div className="bms-tile-label">{label}</div>
      <div className="bms-tile-value">{value}</div>
      {note && <div className="bms-note">{note}</div>}
    </div>
  )
}

function MinuteChart({ perMinute, generatedAt }: { perMinute: number[]; generatedAt: string }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...perMinute)
  const end = new Date(generatedAt).getTime()
  const minuteAt = (i: number) => clock(end - (perMinute.length - 1 - i) * 60_000)
  const peakIndex = perMinute.indexOf(Math.max(...perMinute))
  const readout = hovered === null
    ? `Busiest minute: ${num(perMinute[peakIndex])} at ${minuteAt(peakIndex)}`
    : `${minuteAt(hovered)} — ${num(perMinute[hovered])} request${perMinute[hovered] === 1 ? '' : 's'}`
  return (
    <div>
      <div className="bms-chart-readout" aria-live="off">{readout}</div>
      <div
        className="bms-chart"
        role="img"
        aria-label={`Requests to BAT per minute over the past 60 minutes. ${readout}.`}
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

export default function BmStats() {
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/bmstats', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: Status) => {
          if (cancelled) return
          setStatus(data)
          setFailed(false)
        })
        .catch(() => { if (!cancelled) setFailed(true) })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!status) {
    return <p className="bms-note" role="status">{failed ? 'Could not load the server status.' : 'Loading…'}</p>
  }

  const { cpu, memory, disk, worker, bat, visitors } = status
  return (
    <div className="bms">
      <header className="bms-header">
        <h1 className="bms-title">Server status</h1>
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
      </Card>

      <Card title="Requests to BAT">
        <div className="bms-grid">
          <Tile label="Today" value={num(bat.today)} note={`since midnight, ${bat.day}`} />
          <Tile label="Past 60 minutes" value={num(bat.lastHour)} note={`${num(bat.perMinute[bat.perMinute.length - 1])} in the current minute`} />
          <Tile label="Failed today" value={num(bat.failedToday)} note="errors and non-200 responses" />
        </div>
        <h3 className="bms-subtitle">Per minute, past 60 minutes</h3>
        <MinuteChart perMinute={bat.perMinute} generatedAt={status.generatedAt} />
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

      <Card title="Worker">
        <div className="bms-grid">
          <Tile label="Uptime" value={duration(worker.uptimeSeconds)} note={`started ${clock(worker.startedAt)}`} />
          <Tile label="Starts today" value={num(bat.startsToday)} note="1 means no restarts" />
          <Tile label="Memory" value={bytes(worker.rssBytes)} note={`peak ${bytes(worker.peakRssBytes)} · heap ${bytes(worker.heapUsedBytes)}`} />
        </div>
        <p className="bms-note">Node {worker.node} · pid {worker.pid}</p>
      </Card>

      <Card title="Visitors">
        <div className="bms-grid">
          <Tile label="Online now" value={num(visitors.online)} />
          <Tile label="Peak today" value={num(visitors.peak)} note={visitors.peakAt ? `at ${clock(visitors.peakAt)}` : undefined} />
          <Tile label="Users today" value={num(visitors.users)} />
        </div>
      </Card>
    </div>
  )
}
