import type {
  CountryMatrixData,
  CountryMatrixEvent,
  CountryMatrixGender,
  MatchScore,
  StatsCountryMatrixCell,
  StatsCountryMatrixMatch,
} from './types'

// Each country's overall record across every opponent, i.e. the row sum of the
// head-to-head grid. Derived from `cells` on the fly (not stored on the blob),
// so stats cached before this column existed still render — the same
// forward-compat reason `countryMatrix` itself is optional. Accepts any grid
// (the all-ages matrix or a per-age-group sub-matrix).
export function countryMatrixRowTotals(
  matrix: CountryMatrixData,
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

// Merge several head-to-head grids into one by summing matching cells. Used to
// combine the (age, gender) leaf buckets that match the UI's selected filters.
// Each input grid is symmetric (cells[a][b] and cells[b][a] both stored), so
// summing per [row][col] keeps the merged grid symmetric too. The country axis
// is rebuilt and re-sorted by total matches desc, then code asc — matching the
// server's ordering so a merged view reads like a natively-built one.
export function mergeCountryMatrices(parts: CountryMatrixData[]): CountryMatrixData {
  const cells: Record<string, Record<string, StatsCountryMatrixCell>> = {}
  for (const part of parts) {
    for (const row of part.countries) {
      const rowCells = part.cells[row]
      if (!rowCells) continue
      for (const col of part.countries) {
        const src = rowCells[col]
        if (!src) continue
        const dst = (cells[row] ??= {})
        dst[col] ??= { w: 0, l: 0 }
        dst[col].w += src.w
        dst[col].l += src.l
      }
    }
  }
  const totalOf = (c: string) =>
    Object.values(cells[c] ?? {}).reduce((s, x) => s + x.w + x.l, 0)
  const countries = Object.keys(cells).sort(
    (a, b) => totalOf(b) - totalOf(a) || a.localeCompare(b),
  )
  return { countries, cells }
}

// A cross-country match oriented so the clicked row country reads first.
export interface OrientedCellMatch extends StatsCountryMatrixMatch {
  rowTeam: string[]      // the row country's players
  colTeam: string[]      // the opponent country's players
  rowWon: boolean        // did the row country win
  rowScores: MatchScore[] // scores from the row country's perspective (their points as t1)
}

export interface CellMatchFilters {
  age?: string                       // 'all' or an ageGroup like "U19"
  gender?: CountryMatrixGender | 'all'
  discipline?: CountryMatrixEvent | 'all'
}

// The matches behind a clicked cell: every stored cross-country match between
// `row` and `col` (in either stored order), narrowed to the active age/gender/
// discipline filters, and oriented so the row country reads as the first team.
// Mixed matches carry no gender, so a male/female gender filter excludes them —
// matching the grid's bucket logic.
export function countryMatrixCellMatches(
  matches: StatsCountryMatrixMatch[],
  row: string,
  col: string,
  filters: CellMatchFilters,
): OrientedCellMatch[] {
  const { age, gender, discipline } = filters
  const out: OrientedCellMatch[] = []
  for (const m of matches) {
    const isPair =
      (m.country1 === row && m.country2 === col) ||
      (m.country1 === col && m.country2 === row)
    if (!isPair) continue
    if (age && age !== 'all' && m.ageGroup !== age) continue
    if (gender && gender !== 'all' && m.gender !== gender) continue
    if (discipline && discipline !== 'all' && m.discipline !== discipline) continue

    const rowIsTeam1 = m.country1 === row
    const rowTeam = rowIsTeam1 ? m.team1 : m.team2
    const colTeam = rowIsTeam1 ? m.team2 : m.team1
    const rowSide = rowIsTeam1 ? 1 : 2
    const rowWon = m.winnerSide === rowSide
    const rowScores = rowIsTeam1
      ? m.scores
      : m.scores.map((s) => ({ t1: s.t2, t2: s.t1 }))
    out.push({ ...m, rowTeam, colTeam, rowWon, rowScores })
  }
  return out
}
