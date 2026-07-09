'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import { countryMatrixRowTotals } from '@/lib/countryMatrix'
import type { StatsCountryMatrix, StatsCountryMatrixCell } from '@/lib/types'

const pct = (r: number) => `${Math.round(r * 100)}%`
const tintOf = (w: number, l: number) => {
  const r = w / (w + l)
  return r > 0.5 ? 'is-win' : r < 0.5 ? 'is-loss' : 'is-even'
}

function Cell({ cell, extra }: { cell: StatsCountryMatrixCell; extra?: string }) {
  return (
    <>
      <span className="stats-matrix-wl">{cell.w}–{cell.l}</span>
      <span className="stats-matrix-pct">{pct(cell.w / (cell.w + cell.l))}</span>
      {extra}
    </>
  )
}

// The shared head-to-head grid: countries on both axes, cells[row][col] is the
// row country's record vs the column country. A trailing Overall column shows
// each country's aggregate (row total) record and win%. Rendered both inside the
// stats panel and on the standalone /country-matrix page.
export default function CountryMatrixTable({ matrix }: { matrix: StatsCountryMatrix }) {
  const { t } = useLanguage()
  const totals = countryMatrixRowTotals(matrix)

  return (
    <div className="stats-matrix-wrap">
      <table className="stats-matrix">
        <thead>
          <tr>
            <th className="stats-matrix-corner"></th>
            {matrix.countries.map((c) => (
              <th key={c} className="stats-matrix-col" title={countryDisplayName(c) || c}>{c}</th>
            ))}
            <th className="stats-matrix-total-col">{t('statsCountryMatrixTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {matrix.countries.map((row) => {
            const total = totals[row] ?? { w: 0, l: 0 }
            const totalHasPlay = total.w + total.l > 0
            return (
              <tr key={row}>
                <th className="stats-matrix-row" title={countryDisplayName(row) || row}>{row}</th>
                {matrix.countries.map((col) => {
                  if (row === col) return <td key={col} className="stats-matrix-cell stats-matrix-diag" />
                  const cell = matrix.cells[row]?.[col]
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
