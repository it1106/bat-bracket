import { normalizeRound, classifyDiscipline } from '@/lib/playerIndex'

describe('normalizeRound', () => {
  const cases: Array<[string, string]> = [
    ['Final', 'Final'], ['final', 'Final'], ['F', 'Final'],
    ['รอบชิงชนะเลิศ', 'Final'],
    ['Semifinal', 'SF'], ['SF', 'SF'], ['Semi-final', 'SF'],
    ['รอบรองชนะเลิศ', 'SF'],
    ['Quarterfinal', 'QF'], ['QF', 'QF'],
    ['Round of 16', 'R16'], ['R16', 'R16'], ['1/8', 'R16'],
    ['Round of 32', 'R32'], ['R32', 'R32'],
    ['Round of 64', 'R64'],
    ['Round of 128', 'R128'],
    ['Round Robin', 'RR'], ['Group A', 'RR'], ['Round-Robin', 'RR'],
    ['', 'RR'],
  ]
  it.each(cases)('normalizes "%s" -> "%s"', (input, expected) => {
    expect(normalizeRound(input)).toBe(expected)
  })
})

describe('classifyDiscipline', () => {
  it('returns singles for 1-player teams', () => {
    expect(classifyDiscipline(1, 'Boys Singles U15')).toBe('singles')
  })
  it('returns mixed when 2-player team event name signals XD/mixed', () => {
    expect(classifyDiscipline(2, 'Mixed Doubles U15')).toBe('mixed')
    expect(classifyDiscipline(2, 'XD U17')).toBe('mixed')
    expect(classifyDiscipline(2, 'Mixed')).toBe('mixed')
  })
  it('returns doubles otherwise for 2-player teams', () => {
    expect(classifyDiscipline(2, 'BD U15')).toBe('doubles')
    expect(classifyDiscipline(2, 'Boys Doubles')).toBe('doubles')
    expect(classifyDiscipline(2, "Women's Doubles")).toBe('doubles')
  })
})
