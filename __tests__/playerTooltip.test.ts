import { playerTooltip } from '@/components/MatchSchedule'

describe('playerTooltip', () => {
  it('BAT player: shows the club (country absent)', () => {
    expect(playerTooltip('KBA Club', undefined, undefined)).toBe('KBA Club')
  })

  it('BWF player with country + YOB: "INA (2013)"', () => {
    expect(playerTooltip(undefined, 'INA', '2013')).toBe('INA (2013)')
    expect(playerTooltip(undefined, 'THA', '2011')).toBe('THA (2011)')
  })

  it('BWF player with country but no known YOB: country only', () => {
    expect(playerTooltip(undefined, 'INA', undefined)).toBe('INA')
  })

  it('neither club nor country: no tooltip', () => {
    expect(playerTooltip(undefined, undefined, undefined)).toBeUndefined()
  })

  it('club wins over country when both somehow present', () => {
    expect(playerTooltip('Some Club', 'INA', '2013')).toBe('Some Club')
  })
})
