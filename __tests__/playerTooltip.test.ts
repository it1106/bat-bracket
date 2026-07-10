import { playerTooltip } from '@/components/MatchSchedule'

describe('playerTooltip', () => {
  it('BAT player: club, no YOB → club only', () => {
    expect(playerTooltip('KBA Club', undefined, undefined)).toBe('KBA Club')
  })

  it('BAT player with club + YOB: "KBA Club (2011)"', () => {
    expect(playerTooltip('KBA Club', undefined, '2011')).toBe('KBA Club (2011)')
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

  it('club takes precedence over country as the base label, YOB appended', () => {
    expect(playerTooltip('Some Club', 'INA', '2013')).toBe('Some Club (2013)')
  })
})
