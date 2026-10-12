/**
 * @jest-environment jsdom
 */
import {
  currentTerm,
  andPrefix,
  replaceTerm,
  buildSuggestions,
  candidatesFromMatches,
  candidatesFromScheduleGroups,
  candidatesFromBracketHtml,
  type Suggestion,
} from '@/lib/searchSuggestions'

const player = (value: string): Suggestion => ({ value, kind: 'player' })
const event = (value: string): Suggestion => ({ value, kind: 'event' })

describe('currentTerm', () => {
  it('returns the whole query when there is no separator', () => {
    expect(currentTerm('somch')).toEqual({ text: 'somch', start: 0, end: 5 })
  })

  it('returns an empty term for an empty query', () => {
    expect(currentTerm('')).toEqual({ text: '', start: 0, end: 0 })
  })

  it('takes the segment after the last & and drops surrounding space', () => {
    // The offsets point at the trimmed term inside the original string, so a
    // replacement never eats the space the reader typed after '&'.
    expect(currentTerm('BS U15 & somch')).toEqual({ text: 'somch', start: 9, end: 14 })
  })

  it('takes the segment after the last | too', () => {
    expect(currentTerm('kba | bty')).toEqual({ text: 'bty', start: 6, end: 9 })
  })

  it('uses whichever separator comes last', () => {
    expect(currentTerm('a | b & c')).toEqual({ text: 'c', start: 8, end: 9 })
    expect(currentTerm('a & b | c')).toEqual({ text: 'c', start: 8, end: 9 })
  })

  it('is empty right after a separator', () => {
    const t = currentTerm('BS U15 & ')
    expect(t.text).toBe('')
    expect(t.start).toBe(t.end)
  })

  it('reports an empty term for a whitespace-only query', () => {
    expect(currentTerm('   ').text).toBe('')
  })
})

describe('andPrefix', () => {
  it('is empty when nothing precedes the term', () => {
    expect(andPrefix('somch')).toBe('')
    expect(andPrefix('')).toBe('')
  })

  it('returns the AND groups already typed', () => {
    expect(andPrefix('BS U15 & somch')).toBe('BS U15')
    expect(andPrefix('BS U15 & QF & som')).toBe('BS U15 & QF')
  })

  it('keeps a trailing OR group whole', () => {
    // '|' is an alternative inside the current group, not a narrowing step.
    expect(andPrefix('BS U15 & kba | bt')).toBe('BS U15')
    expect(andPrefix('kba | bt')).toBe('')
  })

  it('handles a query ending in a separator', () => {
    expect(andPrefix('BS U15 & ')).toBe('BS U15')
  })
})

describe('replaceTerm', () => {
  it('replaces a lone term', () => {
    expect(replaceTerm('somch', 'Somchai Suksawat')).toBe('Somchai Suksawat')
  })

  it('keeps the prefix before an & separator', () => {
    expect(replaceTerm('BS U15 & somch', 'Somchai Suksawat')).toBe('BS U15 & Somchai Suksawat')
  })

  it('keeps the prefix before an | separator', () => {
    expect(replaceTerm('kba | bt', 'Banthongyord')).toBe('kba | Banthongyord')
  })

  it('appends after a trailing separator', () => {
    expect(replaceTerm('BS U15 & ', 'Somchai Suksawat')).toBe('BS U15 & Somchai Suksawat')
  })

  it('fills an empty query', () => {
    expect(replaceTerm('', 'BS U15')).toBe('BS U15')
  })

  it('leaves text after the term alone', () => {
    // The caret can sit mid-query; only the completed segment changes.
    expect(replaceTerm('som', 'Somchai Suksawat')).toBe('Somchai Suksawat')
  })
})

describe('buildSuggestions', () => {
  const pool: Suggestion[] = [
    player('Somchai Suksawat'),
    player('Anan Wongsiri'),
    player('Somsak Chaiyo'),
    event('BS U15'),
    event('GD U19'),
  ]

  it('returns nothing for an empty term', () => {
    expect(buildSuggestions(pool, '')).toEqual([])
  })

  it('matches by case-insensitive substring', () => {
    expect(buildSuggestions(pool, 'wong')).toEqual([player('Anan Wongsiri')])
    expect(buildSuggestions(pool, 'WONG')).toEqual([player('Anan Wongsiri')])
  })

  it('matches event types', () => {
    expect(buildSuggestions(pool, 'u1')).toEqual([event('BS U15'), event('GD U19')])
  })

  it('ranks prefix matches before later matches', () => {
    const hits = buildSuggestions(
      [player('Anan Somchai'), player('Somchai Suksawat')],
      'som',
    )
    expect(hits).toEqual([player('Somchai Suksawat'), player('Anan Somchai')])
  })

  it('breaks ties alphabetically', () => {
    expect(buildSuggestions(pool, 'som')).toEqual([
      player('Somchai Suksawat'),
      player('Somsak Chaiyo'),
    ])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    const hits = buildSuggestions(
      [player('Somchai Suksawat'), player('SOMCHAI SUKSAWAT')],
      'somchai',
    )
    expect(hits).toEqual([player('Somchai Suksawat')])
  })

  it('ignores blank candidate values', () => {
    expect(buildSuggestions([player('   '), player('Somchai')], 'som')).toEqual([
      player('Somchai'),
    ])
  })

  it('trims the term before matching', () => {
    expect(buildSuggestions(pool, '  wong  ')).toEqual([player('Anan Wongsiri')])
  })

  it('caps the list at the given limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => player(`Player ${String(i).padStart(2, '0')}`))
    expect(buildSuggestions(many, 'player', 8)).toHaveLength(8)
    expect(buildSuggestions(many, 'player')).toHaveLength(8)
  })

  it('matches Thai text', () => {
    const thai = [player('สมชาย สุขสวัสดิ์'), player('อนันต์ วงศ์ศิริ')]
    expect(buildSuggestions(thai, 'สมชาย')).toEqual([player('สมชาย สุขสวัสดิ์')])
  })

  it('does not suggest a value identical to the term', () => {
    // Once the reader has the full name in the box there is nothing to complete.
    expect(buildSuggestions(pool, 'BS U15')).toEqual([])
    expect(buildSuggestions(pool, 'bs u15')).toEqual([])
  })
})

describe('candidatesFromMatches', () => {
  const match = (draw: string, t1: string[], t2: string[]) => ({
    draw,
    drawNum: '1',
    round: 'Final',
    team1: t1.map((name, i) => ({ name, playerId: `${draw}-1-${i}` })),
    team2: t2.map((name, i) => ({ name, playerId: `${draw}-2-${i}` })),
    winner: null,
    scores: [],
    court: '1',
    walkover: false,
    retired: false,
    nowPlaying: false,
  })

  it('collects every player and the draw name', () => {
    const got = candidatesFromMatches([match('BS U15', ['Somchai'], ['Anan'])])
    expect(got).toEqual([
      { value: 'BS U15', kind: 'event' },
      { value: 'Somchai', kind: 'player' },
      { value: 'Anan', kind: 'player' },
    ])
  })

  it('collects both partners of a doubles pair', () => {
    const got = candidatesFromMatches([match('GD U19', ['A', 'B'], ['C', 'D'])])
    expect(got.filter((c) => c.kind === 'player').map((c) => c.value)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('skips blank names and draws', () => {
    const got = candidatesFromMatches([match('', ['', 'Somchai'], [])])
    expect(got).toEqual([{ value: 'Somchai', kind: 'player' }])
  })

  it('strips the seed marker from player names', () => {
    // The marker is display chrome; a bare name still matches the stored one,
    // and the seeded/unseeded spellings collapse into a single suggestion.
    const got = candidatesFromMatches([match('BS U15', ['Somchai Suksawat [2]'], ['Anan [10]'])])
    expect(got.filter((c) => c.kind === 'player').map((c) => c.value)).toEqual([
      'Somchai Suksawat',
      'Anan',
    ])
  })

  it('strips a split seed marker', () => {
    const got = candidatesFromMatches([match('BS U15', ['Somchai Suksawat [5/8]'], [])])
    expect(got[1]).toEqual({ value: 'Somchai Suksawat', kind: 'player' })
  })

  it('keeps brackets that are part of the name', () => {
    const got = candidatesFromMatches([match('BS U15', ['Somchai [JR] Suksawat'], [])])
    expect(got[1]).toEqual({ value: 'Somchai [JR] Suksawat', kind: 'player' })
  })

  it('drops a name that is nothing but a seed marker', () => {
    expect(candidatesFromMatches([match('BS U15', ['[1]'], [])])).toEqual([
      { value: 'BS U15', kind: 'event' },
    ])
  })

  it('accepts several match lists at once', () => {
    const got = candidatesFromMatches(
      [match('BS U15', ['Somchai'], [])],
      [match('GD U19', ['Anan'], [])],
    )
    expect(got.map((c) => c.value)).toEqual(['BS U15', 'Somchai', 'GD U19', 'Anan'])
  })
})

describe('candidatesFromScheduleGroups', () => {
  const entry = (draw: string, name: string) => ({
    draw, drawNum: '1', round: 'Final',
    team1: [{ name, playerId: 'p1' }], team2: [],
    winner: null, scores: [], court: '1',
    walkover: false, retired: false, nowPlaying: false,
  })

  it('flattens time and court groups', () => {
    const got = candidatesFromScheduleGroups([
      { type: 'time', time: '09:00', matches: [entry('BS U15', 'Somchai')] },
      { type: 'court', court: '3', matches: [entry('GD U19', 'Anan')] },
    ] as never)
    expect(got.map((c) => c.value)).toEqual(['BS U15', 'Somchai', 'GD U19', 'Anan'])
  })

  it('handles an empty schedule', () => {
    expect(candidatesFromScheduleGroups([])).toEqual([])
  })
})

describe('candidatesFromBracketHtml', () => {
  it('reads names out of parsed-bracket rows', () => {
    const html = `
      <div class="bk-row"><span class="bk-player" data-player-id="1">Somchai Suksawat</span></div>
      <div class="bk-row"><span class="bk-player" data-player-id="2">Anan Wongsiri</span></div>`
    expect(candidatesFromBracketHtml(html)).toEqual([
      { value: 'Somchai Suksawat', kind: 'player' },
      { value: 'Anan Wongsiri', kind: 'player' },
    ])
  })

  it('reads names out of raw BAT bracket rows', () => {
    const html = `
      <div class="match__row"><div class="match__row-title-value-content">
        <a data-player-id="1">Somchai Suksawat</a>
      </div></div>`
    expect(candidatesFromBracketHtml(html)).toEqual([
      { value: 'Somchai Suksawat', kind: 'player' },
    ])
  })

  it('strips seed markers from bracket names', () => {
    const html = '<div class="bk-row"><span class="bk-player">Somchai Suksawat [1]</span></div>'
    expect(candidatesFromBracketHtml(html)).toEqual([
      { value: 'Somchai Suksawat', kind: 'player' },
    ])
  })

  it('returns nothing for empty or name-less HTML', () => {
    expect(candidatesFromBracketHtml('')).toEqual([])
    expect(candidatesFromBracketHtml('<div class="bk-row"><span class="bk-player"></span></div>')).toEqual([])
  })
})
