import {
  roundFromPlacement, roundFromBestFinish, resultKey, resultLabelFor, RESULT_DISPLAY,
} from '@/lib/ranking/result-label'
import { POINTS_ROUNDS } from '@/lib/points/bat-points'

describe('roundFromPlacement', () => {
  it('reads BAT\'s placement bands', () => {
    // The forms actually present in the cached details, most common first.
    expect(roundFromPlacement('9/16')).toBe('R16')
    expect(roundFromPlacement('5/8')).toBe('QF')
    expect(roundFromPlacement('17/32')).toBe('R32')
    expect(roundFromPlacement('3/4')).toBe('SF')
    expect(roundFromPlacement('1')).toBe('Winner')
    expect(roundFromPlacement('33/64')).toBe('R64')
    expect(roundFromPlacement('2')).toBe('RunnerUp')
  })

  it('tolerates padding around the slash', () => {
    expect(roundFromPlacement(' 5 / 8 ')).toBe('QF')
  })

  it('returns null rather than guessing on blank or unknown cells', () => {
    // BAT publishes this column empty on the current edition — every row.
    expect(roundFromPlacement('')).toBeNull()
    expect(roundFromPlacement(undefined)).toBeNull()
    expect(roundFromPlacement('7/9')).toBeNull()
    expect(roundFromPlacement('Q1')).toBeNull()
  })
})

describe('roundFromBestFinish', () => {
  it('translates the two bracket-vocabulary names', () => {
    expect(roundFromBestFinish('Champion')).toBe('Winner')
    expect(roundFromBestFinish('F')).toBe('RunnerUp')
  })

  it('passes the knockout rounds through unchanged', () => {
    expect(roundFromBestFinish('SF')).toBe('SF')
    expect(roundFromBestFinish('R32')).toBe('R32')
  })

  it('has no name for round-robin or missing finishes', () => {
    expect(roundFromBestFinish('RR')).toBeNull()
    expect(roundFromBestFinish(undefined)).toBeNull()
  })
})

describe('RESULT_DISPLAY', () => {
  it('labels every round the points engine knows', () => {
    for (const r of POINTS_ROUNDS) expect(RESULT_DISPLAY[r].length).toBeGreaterThan(0)
  })
})

describe('resultLabelFor', () => {
  const row = { tournamentId: 'dd818643-0e28-4ca2-9e42-eff24884678b', sourceEvent: 'BS U15' }
  const index = { [resultKey(row.tournamentId, 'BS U15')]: 'Champion' }

  it('prefers upstream placement, which covers tournaments we never ingested', () => {
    expect(resultLabelFor({ ...row, result: '5/8' }, index)).toBe('QF')
  })

  it('falls back to the index when upstream left the cell blank', () => {
    // รวิณ's PONSANA row: 8192 pts (the U15 level-2 Winner value) with an
    // empty Result cell upstream. The index knows he won it.
    expect(resultLabelFor({ ...row, result: '' }, index)).toBe('Winner')
  })

  it('matches case-insensitively on the tournament id', () => {
    const upper = { ...row, tournamentId: row.tournamentId.toUpperCase() }
    expect(resultLabelFor(upper, index)).toBe('Winner')
  })

  it('returns null when neither source knows, so the cell can show a dash', () => {
    expect(resultLabelFor({ ...row, sourceEvent: 'BS U17' }, index)).toBeNull()
    expect(resultLabelFor(row)).toBeNull()
  })

  it('does not credit a different event of the same tournament', () => {
    expect(resultLabelFor({ ...row, sourceEvent: 'BD U15' }, index)).toBeNull()
  })
})
