'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import type { StatsEventBreakdown, StatsEventBreakdownCell } from '@/lib/types'

const fmt = (n: number) => n.toLocaleString('en-US')

function labelOf(country: string): string {
  const d = countryDisplayName(country)
  return d && d.toLowerCase() !== country.toLowerCase() ? `${d} (${country})` : country
}

function Cell({ cell }: { cell: StatsEventBreakdownCell }) {
  if (cell.done === 0 && cell.active === 0) return null
  return (
    <>
      {cell.done > 0 && <span>{fmt(cell.done)}</span>}
      {cell.active > 0 && (
        <span className="stats-eb-active">{cell.done > 0 ? ' ' : ''}{fmt(cell.active)}</span>
      )}
    </>
  )
}

export default function EventBreakdownTable({ data }: { data: StatsEventBreakdown }) {
  const { t } = useLanguage()
  const [event, setEvent] = useState<'all' | string>('all')

  const columns = event === 'all' ? data.columns : (data.columnsByEvent[event] ?? [])

  // Aggregate the current scope: country -> bucket -> summed cell.
  const scope = new Map<string, Map<string, StatsEventBreakdownCell>>()
  const eventsInScope = event === 'all' ? Object.keys(data.counts) : [event]
  for (const ev of eventsInScope) {
    const byCountry = data.counts[ev] ?? {}
    for (const [country, byBucket] of Object.entries(byCountry)) {
      if (country === '—') continue
      let m = scope.get(country)
      if (!m) { m = new Map(); scope.set(country, m) }
      for (const [bucket, cell] of Object.entries(byBucket)) {
        const cur = m.get(bucket) ?? { done: 0, active: 0 }
        m.set(bucket, { done: cur.done + cell.done, active: cur.active + cell.active })
      }
    }
  }

  const rows = Array.from(scope.entries())
    .map(([country, byBucket]) => {
      let total = 0
      for (const b of columns) {
        const c = byBucket.get(b)
        if (c) total += c.done + c.active
      }
      return { country, byBucket, total }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || labelOf(a.country).localeCompare(labelOf(b.country)))

  if (rows.length === 0) return null

  const colLabel = (bucket: string) =>
    bucket === 'Champion' ? t('statsEventBreakdownChampion') : bucket

  return (
    <>
      <div className="stats-matrix-agesel">
        <label>
          {t('statsEventBreakdownFilter')}{' '}
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="all">{t('statsEventBreakdownAll')}</option>
            {data.events.map((ev) => (
              <option key={ev.key} value={ev.key}>{ev.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="stats-eb-scroll">
        <table className="stats-table">
          <thead><tr>
            <th></th>
            <th>{t('statsColCountry')}</th>
            {columns.map((b) => <th key={b} className="stats-num">{colLabel(b)}</th>)}
            <th className="stats-num">{t('statsEventBreakdownTotal')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.country}>
                <td className="stats-rank">{i + 1}</td>
                <td>{labelOf(r.country)}</td>
                {columns.map((b) => (
                  <td key={b} className="stats-num">
                    <Cell cell={r.byBucket.get(b) ?? { done: 0, active: 0 }} />
                  </td>
                ))}
                <td className="stats-num">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
