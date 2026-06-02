import {
  topRowsForTab,
  otherRowsForTab,
  disciplineOf,
  ageGroupRank,
  dedupePerTournament,
  expiringNextWeekCutoff,
  expiringWithinWeeksCutoff,
  isExpiringNextWeek,
  computeExpiryCutoffs,
  classifyExpiry,
  weekKeyFromPublishDate,
  EXPIRY_SOON_HORIZON_WEEKS,
  TOP_N,
} from '@/lib/bat-ranking-player-view'
import type { BatRankingPlayerDetail, BatRankingPlayerTournament } from '@/lib/types'

const t = (
  sourceEvent: string,
  points: number,
  week: string = '2026-20',
  countsTowardRankings: string[] = [],
  tournamentName?: string,
): BatRankingPlayerTournament => ({
  // Default tournamentName includes points so unrelated synthetic rows do
  // not accidentally dedupe; pass explicitly when testing dedup.
  tournamentName: tournamentName ?? `Tourn ${sourceEvent} ${points}`,
  tournamentId: null,
  sourceEvent,
  week,
  result: '1/2',
  points,
  countsTowardRankings,
})

const detail = (tournaments: BatRankingPlayerTournament[]): BatRankingPlayerDetail => ({
  globalPlayerId: '3903158',
  publishDate: '26/5/2569',
  scrapedAt: 'x',
  tournaments,
})

describe('disciplineOf', () => {
  it('classifies XD as mixed', () => {
    expect(disciplineOf('XD U15')).toBe('mixed')
  })
  it('classifies BD/GD/MD/WD as doubles', () => {
    expect(disciplineOf('BD U15')).toBe('doubles')
    expect(disciplineOf('GD U15')).toBe('doubles')
    expect(disciplineOf('MD U23')).toBe('doubles')
    expect(disciplineOf('WD U23')).toBe('doubles')
  })
  it('classifies BS/GS/MS/WS as singles', () => {
    expect(disciplineOf('BS U15')).toBe('singles')
    expect(disciplineOf('GS U15')).toBe('singles')
    expect(disciplineOf('MS U23')).toBe('singles')
    expect(disciplineOf('WS U23')).toBe('singles')
  })
})

describe('ageGroupRank', () => {
  it('extracts the U-number', () => {
    expect(ageGroupRank('BS U13')).toBe(13)
    expect(ageGroupRank('BS U15')).toBe(15)
    expect(ageGroupRank('BS U23')).toBe(23)
  })
  it('returns Infinity for open (no U-marker) so open beats any U-bound at tie-break', () => {
    expect(ageGroupRank('BS')).toBe(Number.POSITIVE_INFINITY)
    expect(ageGroupRank("Men's singles")).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('dedupePerTournament', () => {
  it('keeps the higher-points row for the same (tournament, week)', () => {
    const out = dedupePerTournament([
      t('BS U13', 4194, '2025-28', [], 'Haier CUP 2025'),
      t('BS U15', 3355, '2025-28', [], 'Haier CUP 2025'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U13')
  })

  it("when neither row is marked, point-tie falls back to the higher age group", () => {
    const out = dedupePerTournament([
      t('BS U13', 4194, '2026-19', [], 'SPRC 2026'),
      t('BS U15', 4194, '2026-19', [], 'SPRC 2026'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U15')
  })

  it('input order does not affect the outcome', () => {
    const a = dedupePerTournament([
      t('BS U13', 4194, '2026-19', [], 'SPRC'),
      t('BS U15', 4194, '2026-19', [], 'SPRC'),
    ])
    const b = dedupePerTournament([
      t('BS U15', 4194, '2026-19', [], 'SPRC'),
      t('BS U13', 4194, '2026-19', [], 'SPRC'),
    ])
    expect(a[0].sourceEvent).toBe('BS U15')
    expect(b[0].sourceEvent).toBe('BS U15')
  })

  it("BAT's marker wins over an unmarked sibling — even at the same points", () => {
    // ภูมิพิพัชญ์'s real SPRC row: U15 (no marker) 4194 vs U13 (marked) 4194.
    // BAT credits U13; mirror that.
    const out = dedupePerTournament([
      t('BS U15', 4194, '2026-19', [],                       'SPRC 2026'),
      t('BS U13', 4194, '2026-19', ["U23 Men's singles"],   'SPRC 2026'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U13')
  })

  it("BAT's marker wins even when the unmarked sibling has HIGHER points", () => {
    // Defensive: shouldn't happen in practice (BAT marks the better row),
    // but if it ever does, we still trust BAT's marker.
    const out = dedupePerTournament([
      t('BS U15', 9999, '2026-19', [],                       'X'),
      t('BS U13',  100, '2026-19', ["U23 Men's singles"],   'X'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U13')
  })

  it('when both rows carry a marker (rare/defensive), points then age decide', () => {
    const out = dedupePerTournament([
      t('BS U13', 4000, '2026-19', ["U23 Men's singles"], 'X'),
      t('BS U15', 5000, '2026-19', ["U23 Men's singles"], 'X'),
    ])
    expect(out[0].sourceEvent).toBe('BS U15')
  })

  it('different tournaments at the same week stay separate', () => {
    const out = dedupePerTournament([
      t('BS U13', 4194, '2026-19', [], 'SPRC 2026'),
      t('BS U13', 4194, '2026-19', [], 'Haier 2026'),
    ])
    expect(out).toHaveLength(2)
  })

  it('same tournament name across different weeks (different yearly editions) stays separate', () => {
    const out = dedupePerTournament([
      t('BS U13', 4194, '2026-19', [], 'SPRC'),
      t('BS U13', 4194, '2025-19', [], 'SPRC'),
    ])
    expect(out).toHaveLength(2)
  })

  it('open events outrank U-bounded events at tie-break', () => {
    const out = dedupePerTournament([
      t('BS U23', 1000, '2026-10', [], 'X'),
      t('BS',     1000, '2026-10', [], 'X'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS')
  })

  it('handles 3-way collisions correctly', () => {
    const out = dedupePerTournament([
      t('BS U13', 4194, '2026-19', [], 'SPRC'),
      t('BS U15', 4194, '2026-19', [], 'SPRC'),
      t('BS U17', 3000, '2026-19', [], 'SPRC'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U15') // tie at 4194, U15 > U13; U17 loses on points
  })

  it('trims tournament name whitespace before comparing (defensive)', () => {
    const out = dedupePerTournament([
      t('BS U13', 100, '2026-10', [], 'SPRC '),
      t('BS U15', 100, '2026-10', [], ' SPRC'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U15')
  })
})

describe('topRowsForTab', () => {
  it('returns [] when the player has no rows in the requested discipline', () => {
    const d = detail([t('MD U15', 3000)])
    expect(topRowsForTab(d, 'singles')).toEqual([])
  })

  it('filters by discipline — singles tab excludes doubles and mixed rows', () => {
    const d = detail([
      t('BS U15', 3000, '2026-10'),
      t('MD U15', 2000, '2026-10'),
      t('XD U15', 1000, '2026-10'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(1)
    expect(rows[0].sourceEvent).toBe('BS U15')
  })

  it('picks the top-10 by points and DROPS the rest (no show-more)', () => {
    // 15 rows, points 100..114. Top 10 by points are 105..114; rest are 100..104.
    const tournaments = Array.from({ length: 15 }, (_, i) =>
      t('BS U15', 100 + i, `2026-${(i % 50) + 1}`),
    )
    const d = detail(tournaments)
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(TOP_N)
    // None of the dropped rows (points < 105) should appear.
    expect(rows.every((r) => r.points >= 105)).toBe(true)
  })

  it('sorts the survivors by week descending (newest first)', () => {
    const d = detail([
      t('BS U15', 3000, '2026-05'),
      t('BS U15', 2500, '2026-20'),
      t('BS U15', 2000, '2026-01'),
      t('BS U15', 1500, '2025-50'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.week)).toEqual(['2026-20', '2026-05', '2026-01', '2025-50'])
  })

  it('handles BAT 1-digit week strings (e.g. "2026-5" is NOT newer than "2026-20")', () => {
    // Regression: plain localeCompare puts "2026-5" before "2026-20" because
    // '5' > '2' in ASCII. Use weekSortKey() to zero-pad.
    const d = detail([
      t('BS U15', 1000, '2026-5'),
      t('BS U15', 1000, '2026-20'),
      t('BS U15', 1000, '2026-15'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.week)).toEqual(['2026-20', '2026-15', '2026-5'])
  })

  it('on point-tie, prefers the more recent row when deciding who makes the cut', () => {
    // Two rows tied at 100 pts; only one fits in the top-N. The newer week wins.
    const filler = Array.from({ length: 9 }, (_, i) => t('BS U15', 1000 + i, '2026-01'))
    const d = detail([
      ...filler,
      t('BS U15', 100, '2026-05'),
      t('BS U15', 100, '2025-10'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(TOP_N)
    const hundredPointRows = rows.filter((r) => r.points === 100)
    expect(hundredPointRows).toHaveLength(1)
    expect(hundredPointRows[0].week).toBe('2026-05')
  })

  it('returns fewer than 10 rows when the player has fewer contributors', () => {
    const d = detail([
      t('BS U15', 3000, '2026-10'),
      t('BS U15', 2000, '2026-05'),
    ])
    expect(topRowsForTab(d, 'singles')).toHaveLength(2)
  })

  it('does not need the countsTowardRankings field — purely points-driven', () => {
    // Even rows with empty countsTowardRankings still surface if they're top-10 by points.
    const d = detail([
      t('BS U15', 5000, '2026-10', []),     // no markers — still counts here
      t('BS U15', 3000, '2026-05', ["U23 Men's singles"]),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows.map((r) => r.points)).toEqual([5000, 3000])
  })

  it("mirrors ภูมิพิพัชญ์'s SPRC + Haier scenario end-to-end (BAT marker wins)", () => {
    // Real markers from BAT for this player: BS U13 carries the
    // `Used for: U23/U19/U17/U15/U13 Boys singles` marker on both SPRC and
    // Haier rows. BS U15 has no marker on either. So BAT credits U13 in
    // both cases — even when SPRC's two rows are tied at 4194 pts.
    const m = ["U23 Men's singles"]
    const d = detail([
      t('BS U15', 4194, '2026-19', [], 'SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026'),
      t('BS U13', 4194, '2026-19', m,  'SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026'),
      t('BS U15', 3355, '2025-28', [], 'Haier CUP 2025'),
      t('BS U13', 4194, '2025-28', m,  'Haier CUP 2025'),
    ])
    const rows = topRowsForTab(d, 'singles')
    expect(rows).toHaveLength(2)
    const sprc = rows.find((r) => r.tournamentName.startsWith('SPRC'))!
    const haier = rows.find((r) => r.tournamentName.startsWith('Haier'))!
    expect(sprc.sourceEvent).toBe('BS U13')  // marker wins, even though points tie
    expect(haier.sourceEvent).toBe('BS U13') // marker wins (also higher points here)
  })
})

describe('otherRowsForTab', () => {
  it('returns [] when the player has 10 or fewer rows in this discipline', () => {
    const d = detail([
      t('BS U15', 5000, '2026-10'),
      t('BS U15', 4000, '2026-05'),
    ])
    expect(otherRowsForTab(d, 'singles')).toEqual([])
  })

  it('returns rows BEYOND the top-N, ordered by points desc', () => {
    // 15 rows with distinct points so the cut is unambiguous.
    const tournaments = Array.from({ length: 15 }, (_, i) =>
      t('BS U15', 100 + i, `2026-${i + 1}`),
    )
    const d = detail(tournaments)
    const others = otherRowsForTab(d, 'singles')
    expect(others).toHaveLength(5)
    // Highest-pointing among the leftover (just below the cut) is at the top.
    expect(others.map((r) => r.points)).toEqual([104, 103, 102, 101, 100])
  })

  it('top and others partition the deduped set — never overlap, no row is dropped', () => {
    const tournaments = Array.from({ length: 14 }, (_, i) =>
      t('BS U15', 100 + i, `2026-${i + 1}`),
    )
    const d = detail(tournaments)
    const top = topRowsForTab(d, 'singles')
    const others = otherRowsForTab(d, 'singles')
    expect(top.length + others.length).toBe(14)
    const ids = new Set([
      ...top.map((r) => `${r.week}-${r.points}`),
      ...others.map((r) => `${r.week}-${r.points}`),
    ])
    expect(ids.size).toBe(14) // no overlap
  })

  it('respects per-tournament dedup before assigning to top/others', () => {
    // Two SPRC rows + 11 distinct fillers. Without dedup, total = 13 → top 10 + 3 others.
    // With dedup, total = 12 → top 10 + 2 others.
    const fillers = Array.from({ length: 11 }, (_, i) =>
      t('BS U15', 1000 + i, `2026-${i + 1}`),
    )
    const d = detail([
      ...fillers,
      t('BS U15', 500, '2025-19', [], 'SPRC'),
      t('BS U13', 500, '2025-19', ['x'], 'SPRC'), // marker wins → U13 stays, U15 dropped
    ])
    const others = otherRowsForTab(d, 'singles')
    // The deduped SPRC row (BS U13, 500 pts) is in others; the U15 sibling is gone.
    expect(others.length).toBe(2)
    const sprcOther = others.find((r) => r.tournamentName === 'SPRC')
    expect(sprcOther?.sourceEvent).toBe('BS U13')
  })

  it('discipline filter applies (singles tab does not surface doubles in Others)', () => {
    const fillers = Array.from({ length: 11 }, (_, i) =>
      t('BS U15', 1000 + i, `2026-${i + 1}`),
    )
    const d = detail([
      ...fillers,
      t('MD U15', 9999, '2026-10'), // doubles — must NOT appear in singles others
    ])
    const others = otherRowsForTab(d, 'singles')
    expect(others.every((r) => r.sourceEvent.startsWith('BS'))).toBe(true)
  })
})

describe('expiringNextWeekCutoff', () => {
  it("returns '2025-22' for BAT publishDate '26/5/2569' (= 26 May 2026 = week 2026-22)", () => {
    // User-stated canonical example: this is the exact rule we're encoding.
    expect(expiringNextWeekCutoff('26/5/2569')).toBe('2025-22')
  })

  it('handles single-digit day/month', () => {
    expect(expiringNextWeekCutoff('5/1/2569')).not.toBeNull()
  })

  it('returns null on malformed input', () => {
    expect(expiringNextWeekCutoff('')).toBeNull()
    expect(expiringNextWeekCutoff('not a date')).toBeNull()
    expect(expiringNextWeekCutoff('26/5')).toBeNull()
    expect(expiringNextWeekCutoff('26/5/123')).toBeNull() // year must be 4 digits
  })

  it('rejects CE-shaped years to avoid silent 543-year drift on typo', () => {
    expect(expiringNextWeekCutoff('26/5/2026')).toBeNull()
  })

  it('rejects invalid month/day', () => {
    expect(expiringNextWeekCutoff('32/5/2569')).toBeNull()
    expect(expiringNextWeekCutoff('1/13/2569')).toBeNull()
  })
})

describe('isExpiringNextWeek', () => {
  it('returns false when cutoff is null', () => {
    expect(isExpiringNextWeek('2025-22', null)).toBe(false)
  })

  it('true when row.week == cutoff', () => {
    expect(isExpiringNextWeek('2025-22', '2025-22')).toBe(true)
  })

  it('true when row.week < cutoff (older)', () => {
    expect(isExpiringNextWeek('2025-1', '2025-22')).toBe(true)
    expect(isExpiringNextWeek('2024-50', '2025-22')).toBe(true)
  })

  it('false when row.week > cutoff (newer; still in window)', () => {
    expect(isExpiringNextWeek('2025-23', '2025-22')).toBe(false)
    expect(isExpiringNextWeek('2026-22', '2025-22')).toBe(false)
  })

  it('handles 1-digit week numbers correctly (uses weekSortKey)', () => {
    // Regression: plain localeCompare puts '2025-5' AFTER '2025-22' in ASCII.
    expect(isExpiringNextWeek('2025-5', '2025-22')).toBe(true)
    expect(isExpiringNextWeek('2025-22', '2025-5')).toBe(false)
  })
})

describe('expiringWithinWeeksCutoff', () => {
  it('weeksOut=1 matches expiringNextWeekCutoff (canonical 26/5/2569 → 2025-22)', () => {
    expect(expiringWithinWeeksCutoff('26/5/2569', 1)).toBe('2025-22')
    expect(expiringNextWeekCutoff('26/5/2569')).toBe('2025-22')
  })

  it('weeksOut=4 returns publishDate - 49 weeks (26/5/2569 → 2025-25)', () => {
    expect(expiringWithinWeeksCutoff('26/5/2569', 4)).toBe('2025-25')
  })

  it('weeksOut is monotonic — larger horizon ⇒ later (≥) cutoff week', () => {
    // The cutoff for weeksOut=n is the latest week whose rows are removed
    // within n publications, so it should never regress as n grows.
    const k1 = expiringWithinWeeksCutoff('26/5/2569', 1)!
    const k2 = expiringWithinWeeksCutoff('26/5/2569', 2)!
    const k3 = expiringWithinWeeksCutoff('26/5/2569', 3)!
    const k4 = expiringWithinWeeksCutoff('26/5/2569', 4)!
    // weekSortKey-normalized comparison
    const norm = (s: string) => {
      const [y, w] = s.split('-')
      return `${y}-${w.padStart(2, '0')}`
    }
    expect(norm(k1).localeCompare(norm(k2))).toBeLessThanOrEqual(0)
    expect(norm(k2).localeCompare(norm(k3))).toBeLessThanOrEqual(0)
    expect(norm(k3).localeCompare(norm(k4))).toBeLessThanOrEqual(0)
  })

  it('rejects non-positive or non-integer weeksOut', () => {
    expect(expiringWithinWeeksCutoff('26/5/2569', 0)).toBeNull()
    expect(expiringWithinWeeksCutoff('26/5/2569', -1)).toBeNull()
    expect(expiringWithinWeeksCutoff('26/5/2569', 1.5)).toBeNull()
  })
})

describe('computeExpiryCutoffs', () => {
  it('returns {next, soon} for a valid publishDate', () => {
    expect(computeExpiryCutoffs('26/5/2569')).toEqual({
      next: '2025-22',
      soon: '2025-25',
    })
  })

  it('returns {null, null} when publishDate is missing', () => {
    expect(computeExpiryCutoffs(undefined)).toEqual({ next: null, soon: null })
    expect(computeExpiryCutoffs(null)).toEqual({ next: null, soon: null })
    expect(computeExpiryCutoffs('')).toEqual({ next: null, soon: null })
  })

  it("uses EXPIRY_SOON_HORIZON_WEEKS for the 'soon' tier", () => {
    expect(EXPIRY_SOON_HORIZON_WEEKS).toBe(4)
  })
})

describe('classifyExpiry', () => {
  const cutoffs = { next: '2025-22', soon: '2025-25' }

  it("returns 'next' when row.week ≤ next cutoff", () => {
    expect(classifyExpiry('2025-22', cutoffs)).toBe('next')
    expect(classifyExpiry('2025-1', cutoffs)).toBe('next')
    expect(classifyExpiry('2024-50', cutoffs)).toBe('next')
  })

  it("returns 'soon' when row.week is between next and soon cutoffs", () => {
    expect(classifyExpiry('2025-23', cutoffs)).toBe('soon')
    expect(classifyExpiry('2025-24', cutoffs)).toBe('soon')
    expect(classifyExpiry('2025-25', cutoffs)).toBe('soon')
  })

  it('returns null when row.week is newer than the soon cutoff', () => {
    expect(classifyExpiry('2025-26', cutoffs)).toBeNull()
    expect(classifyExpiry('2026-22', cutoffs)).toBeNull()
  })

  it('returns null when both cutoffs are null (no publishDate)', () => {
    expect(classifyExpiry('2025-22', { next: null, soon: null })).toBeNull()
  })

  it("handles 1-digit week numbers correctly (uses weekSortKey)", () => {
    // '2025-5' must classify as 'next' (it's earlier than 2025-22).
    expect(classifyExpiry('2025-5', cutoffs)).toBe('next')
  })
})

describe('weekKeyFromPublishDate', () => {
  it("maps a Buddhist-era publishDate to BAT's YYYY-W key", () => {
    // 2 Jun 2026 = Tuesday in ISO week 23.
    expect(weekKeyFromPublishDate('2/6/2569')).toBe('2026-23')
  })

  it('handles single-digit day and month', () => {
    // 5 Jan 2026 = Monday in ISO week 2 (Jan 1 2026 is a Thursday → week 1
    // contains Mon 29 Dec 2025–Sun 4 Jan 2026, so Jan 5 starts week 2).
    expect(weekKeyFromPublishDate('5/1/2569')).toBe('2026-2')
  })

  it('returns null on malformed input', () => {
    expect(weekKeyFromPublishDate('')).toBeNull()
    expect(weekKeyFromPublishDate('not a date')).toBeNull()
    expect(weekKeyFromPublishDate('2/6')).toBeNull()
  })

  it('rejects CE-shaped year to avoid 543-year silent shift', () => {
    expect(weekKeyFromPublishDate('2/6/2026')).toBeNull()
  })
})
