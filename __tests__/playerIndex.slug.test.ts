import { nameToSlug } from '@/lib/playerIndex'

describe('nameToSlug', () => {
  it('lowercases ASCII letters and underscores spaces', () => {
    expect(nameToSlug('Somchai Suksawat')).toBe('somchai_suksawat')
  })

  it('preserves Thai characters via URL encoding', () => {
    expect(nameToSlug('รวิณ ชูชัยศรี')).toBe(encodeURIComponent('รวิณ') + '_' + encodeURIComponent('ชูชัยศรี'))
  })

  it('strips a leading seed bracket', () => {
    expect(nameToSlug('[1] Anuwat Phromsorn')).toBe('anuwat_phromsorn')
    expect(nameToSlug('[3-4] Sirichai N.')).toBe('sirichai_n.')
    expect(nameToSlug('(SE) Wisut B.')).toBe('wisut_b.')
  })

  it('collapses internal whitespace runs to single underscore', () => {
    expect(nameToSlug('  Paiboon    Khampoom ')).toBe('paiboon_khampoom')
  })

  it('returns the same slug for two name spellings differing only in seed/whitespace', () => {
    expect(nameToSlug('[2] Somchai Suksawat')).toBe(nameToSlug('Somchai   Suksawat'))
  })

  it('returns empty string for empty / whitespace-only input', () => {
    expect(nameToSlug('')).toBe('')
    expect(nameToSlug('   ')).toBe('')
  })
})
