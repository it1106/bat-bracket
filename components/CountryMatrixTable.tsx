'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import { countryMatrixRowTotals } from '@/lib/countryMatrix'
import type { CountryMatrixData, StatsCountryMatrix, StatsCountryMatrixCell } from '@/lib/types'

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
function MatrixGrid({ data, totalLabel }: { data: CountryMatrixData; totalLabel: string }) {
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
                  return (
                    <td key={col} className={`stats-matrix-cell ${tintOf(cell.w, cell.l)}`}>
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

// Wraps the grid with an age-group selector. The top-level matrix is the
// all-ages aggregate (default); each age group folds every discipline in that
// band (e.g. U13 = BS/GS/BD/GD/XD U13). The selector only appears when the
// matrix carries ≥2 age groups. Rendered both in the stats panel and on the
// standalone /country-matrix page.
export default function CountryMatrixTable({ matrix }: { matrix: StatsCountryMatrix }) {
  const { t } = useLanguage()
  const [selected, setSelected] = useState('all')

  const groups = matrix.ageGroups ?? []
  const active: CountryMatrixData =
    selected === 'all' ? matrix : (groups.find((g) => g.ageGroup === selected) ?? matrix)

  return (
    <>
      {groups.length > 0 && (
        <div className="stats-matrix-agesel">
          <label>
            {t('statsCountryMatrixAgeLabel')}{' '}
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="all">{t('statsCountryMatrixAllAges')}</option>
              {groups.map((g) => (
                <option key={g.ageGroup} value={g.ageGroup}>{g.ageGroup}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <MatrixGrid data={active} totalLabel={t('statsCountryMatrixTotal')} />
    </>
  )
}
