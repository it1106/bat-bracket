/**
 * @jest-environment jsdom
 */
import { countryCodesForTerm, queryMatchesCountry } from '@/lib/countryCodes'
import { applyPlayerHighlight } from '@/lib/usePlayerHighlight'

describe('countryCodesForTerm', () => {
  it('resolves an exact 3-letter code', () => {
    expect(countryCodesForTerm('tha')).toEqual(['tha'])
    expect(countryCodesForTerm('THA')).toEqual(['tha'])
  })

  it('resolves a full country name and a prefix', () => {
    expect(countryCodesForTerm('thailand')).toEqual(['tha'])
    expect(countryCodesForTerm('thai')).toEqual(['tha'])
    expect(countryCodesForTerm('indonesia')).toEqual(['ina'])
  })

  it('resolves common alternate names', () => {
    expect(countryCodesForTerm('taiwan')).toEqual(['tpe'])
  })

  it('returns [] for a term that is not a country', () => {
    expect(countryCodesForTerm('somchai')).toEqual([])
    expect(countryCodesForTerm('')).toEqual([])
  })

  it('does not fan out on very short fragments', () => {
    // "ch" is below the name-prefix floor, so it must not pull in China/Chinese Taipei.
    expect(countryCodesForTerm('ch')).toEqual([])
  })
})

describe('queryMatchesCountry (match-list country matching)', () => {
  it('matches a country field by code and by name, but not a name substring', () => {
    expect(queryMatchesCountry(['tha'], 'THA')).toBe(true)
    expect(queryMatchesCountry(['thailand'], 'THA')).toBe(true)
    expect(queryMatchesCountry(['thailand'], 'INA')).toBe(false)
    // A bare "tha" must not match a different country just because of substrings.
    expect(queryMatchesCountry(['tha'], 'INA')).toBe(false)
  })
})

// Minimal bracket-row DOM mirroring bracket-html.ts output.
function bracketRow(name: string, country: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML =
    `<div class="bk-row"><div class="bk-team-players">` +
    `<span class="bk-player" data-country="${country}">${name}</span>` +
    `</div></div>`
  return root
}

describe('applyPlayerHighlight — country on the bracket', () => {
  it('tracks a row by country code', () => {
    const root = bracketRow('Somchai Saetang', 'tha')
    applyPlayerHighlight(root, 'THA')
    expect(root.querySelector('.bk-row')?.classList.contains('tracked')).toBe(true)
  })

  it('tracks a row by full country name', () => {
    const root = bracketRow('Somchai Saetang', 'tha')
    applyPlayerHighlight(root, 'Thailand')
    expect(root.querySelector('.bk-row')?.classList.contains('tracked')).toBe(true)
  })

  it('does not track a different country', () => {
    const root = bracketRow('Anthony Ginting', 'ina')
    applyPlayerHighlight(root, 'thailand')
    expect(root.querySelector('.bk-row')?.classList.contains('tracked')).toBe(false)
  })

  it('country code does not match a mere name substring', () => {
    // "Nattha" contains "tha" but is from INA — a country search must not catch it.
    const root = bracketRow('Nattha Pahwa', 'ina')
    applyPlayerHighlight(root, 'thailand')
    expect(root.querySelector('.bk-row')?.classList.contains('tracked')).toBe(false)
  })
})
