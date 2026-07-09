import type { StatsCountryMatrix, StatsCountryMatrixCell } from './types'

// Each country's overall record across every opponent, i.e. the row sum of the
// head-to-head grid. Derived from `cells` on the fly (not stored on the blob),
// so stats cached before this column existed still render — the same
// forward-compat reason `countryMatrix` itself is optional.
export function countryMatrixRowTotals(
  matrix: StatsCountryMatrix,
): Record<string, StatsCountryMatrixCell> {
  const out: Record<string, StatsCountryMatrixCell> = {}
  for (const row of matrix.countries) {
    const rowCells = matrix.cells[row] ?? {}
    let w = 0
    let l = 0
    for (const col of matrix.countries) {
      const cell = rowCells[col]
      if (cell) {
        w += cell.w
        l += cell.l
      }
    }
    out[row] = { w, l }
  }
  return out
}
