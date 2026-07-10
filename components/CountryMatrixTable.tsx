'use client'

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import { countryMatrixRowTotals, mergeCountryMatrices, countryMatrixCellMatches } from '@/lib/countryMatrix'
import CountryMatrixCellModal from '@/components/CountryMatrixCellModal'
import type {
  CountryMatrixData,
  CountryMatrixEvent,
  CountryMatrixGender,
  StatsCountryMatrix,
  StatsCountryMatrixCell,
} from '@/lib/types'

const GENDER_ORDER: CountryMatrixGender[] = ['male', 'female']
const EVENT_ORDER: CountryMatrixEvent[] = ['singles', 'doubles', 'mixed']

const pct = (r: number) => `${Math.round(r * 100)}%`
const tintOf = (w: number, l: number) => {
  const r = w / (w + l)
  return r > 0.5 ? 'is-win' : r < 0.5 ? 'is-loss' : 'is-even'
}

function Cell({ cell }: { cell: StatsCountryMatrixCell }) {
  return (
    <>
      <span className="stats-matrix-wl">{cell.w}–{cell.l}</span>
      <span className="stats-matrix-pct">{pct(cell.w / (cell.w + cell.l))}</span>
    </>
  )
}

// The head-to-head grid for one matrix (all-ages or a single age group):
// countries on both axes, cells[row][col] is the row country's record vs the
// column country, plus a trailing Overall column with each country's aggregate.
function MatrixGrid({ data, totalLabel, onCellClick }: {
  data: CountryMatrixData
  totalLabel: string
  onCellClick?: (row: string, col: string) => void
}) {
  const totals = countryMatrixRowTotals(data)
  return (
    <div className="stats-matrix-wrap">
      <table className="stats-matrix">
        <thead>
          <tr>
            <th className="stats-matrix-corner"></th>
            {data.countries.map((c) => (
              <th key={c} className="stats-matrix-col" title={countryDisplayName(c) || c}>{c}</th>
            ))}
            <th className="stats-matrix-total-col">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.countries.map((row) => {
            const total = totals[row] ?? { w: 0, l: 0 }
            const totalHasPlay = total.w + total.l > 0
            return (
              <tr key={row}>
                <th className="stats-matrix-row" title={countryDisplayName(row) || row}>{row}</th>
                {data.countries.map((col) => {
                  if (row === col) return <td key={col} className="stats-matrix-cell stats-matrix-diag" />
                  const cell = data.cells[row]?.[col]
                  if (!cell || cell.w + cell.l === 0) return <td key={col} className="stats-matrix-cell" />
                  const clickable = !!onCellClick
                  return (
                    <td
                      key={col}
                      className={`stats-matrix-cell ${tintOf(cell.w, cell.l)}${clickable ? ' stats-matrix-clickable' : ''}`}
                      {...(clickable && {
                        role: 'button',
                        tabIndex: 0,
                        onClick: () => onCellClick!(row, col),
                        onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick!(row, col) } },
                      })}
                    >
                      <Cell cell={cell} />
                    </td>
                  )
                })}
                <td className={`stats-matrix-cell stats-matrix-total ${totalHasPlay ? tintOf(total.w, total.l) : ''}`}>
                  {totalHasPlay ? <Cell cell={total} /> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Wraps the grid with independent age-group and gender selectors. The top-level
// matrix is the all/all aggregate (default). Each leaf bucket is one (age band,
// gender) combination — a band folds every discipline (U13 = BS/GS/BD/GD/XD
// U13) and a gender folds every age (Male = all boys'/men's draws). Selecting
// filters merges the matching buckets. Selectors appear only when the matrix
// carries buckets and the axis has ≥2 values. Rendered in the stats panel and
// on the standalone /country-matrix page.
export default function CountryMatrixTable({ matrix }: { matrix: StatsCountryMatrix }) {
  const { t } = useLanguage()
  const [age, setAge] = useState('all')
  const [gender, setGender] = useState('all')
  const [event, setEvent] = useState('all')
  const [cell, setCell] = useState<{ row: string; col: string } | null>(null)

  const buckets = matrix.buckets ?? []
  const ages = Array.from(new Set(buckets.map((b) => b.ageGroup).filter(Boolean)))
    .sort((a, b) => parseInt(b.slice(1), 10) - parseInt(a.slice(1), 10))
  const genders = GENDER_ORDER.filter((g) => buckets.some((b) => b.gender === g))
  const events = EVENT_ORDER.filter((e) => buckets.some((b) => b.event === e))

  const genderLabel: Record<CountryMatrixGender, string> = {
    male: t('statsCountryMatrixMale'),
    female: t('statsCountryMatrixFemale'),
  }
  const eventLabel: Record<CountryMatrixEvent, string> = {
    singles: t('statsCountryMatrixSingles'),
    doubles: t('statsCountryMatrixDoubles'),
    mixed: t('statsCountryMatrixMixed'),
  }

  // all/all/all → the precomputed top-level aggregate; otherwise merge the
  // buckets matching every active filter (an unmatched combination yields an
  // empty grid). Mixed buckets are genderless, so a male/female gender filter
  // excludes them.
  const active: CountryMatrixData =
    age === 'all' && gender === 'all' && event === 'all'
      ? matrix
      : mergeCountryMatrices(
          buckets.filter((b) =>
            (age === 'all' || b.ageGroup === age) &&
            (gender === 'all' || b.gender === gender) &&
            (event === 'all' || b.event === event),
          ),
        )

  const showFilters = buckets.length > 0 && (ages.length >= 2 || genders.length >= 2 || events.length >= 2)

  // Cells are clickable only when the blob carries the per-match list (absent on
  // older cached blobs). Clicking opens the modal with the matches behind that
  // cell, narrowed to the active filters.
  const allMatches = matrix.matches
  const onCellClick = allMatches ? (row: string, col: string) => setCell({ row, col }) : undefined
  const cellMatches = cell && allMatches
    ? countryMatrixCellMatches(allMatches, cell.row, cell.col, {
        age, gender: gender as CountryMatrixGender | 'all', discipline: event as CountryMatrixEvent | 'all',
      })
    : []

  return (
    <>
      {showFilters && (
        <div className="stats-matrix-agesel">
          {ages.length >= 2 && (
            <label>
              {t('statsCountryMatrixAgeLabel')}{' '}
              <select value={age} onChange={(e) => setAge(e.target.value)}>
                <option value="all">{t('statsCountryMatrixAllAges')}</option>
                {ages.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          )}
          {genders.length >= 2 && (
            <label>
              {t('statsCountryMatrixGenderLabel')}{' '}
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="all">{t('statsCountryMatrixAllGenders')}</option>
                {genders.map((g) => <option key={g} value={g}>{genderLabel[g]}</option>)}
              </select>
            </label>
          )}
          {events.length >= 2 && (
            <label>
              {t('statsCountryMatrixEventLabel')}{' '}
              <select value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="all">{t('statsCountryMatrixAllEvents')}</option>
                {events.map((e) => <option key={e} value={e}>{eventLabel[e]}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {active.countries.length >= 2
        ? <MatrixGrid data={active} totalLabel={t('statsCountryMatrixTotal')} onCellClick={onCellClick} />
        : <p className="country-matrix-page__msg">{t('statsCountryMatrixEmpty')}</p>}
      {cell && cellMatches.length > 0 && (
        <CountryMatrixCellModal row={cell.row} col={cell.col} matches={cellMatches} onClose={() => setCell(null)} />
      )}
    </>
  )
}
