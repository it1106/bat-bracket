/**
 * @jest-environment jsdom
 */
import { loadCustomTab, saveCustomTab, clearCustomTab } from '@/lib/customTab'

beforeEach(() => {
  localStorage.clear()
})

describe('customTab storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadCustomTab()).toBeNull()
  })

  it('round-trips a saved tab', () => {
    saveCustomTab({ nickname: 'My Club', keyword: 'kba & BS U15' })
    expect(loadCustomTab()).toEqual({ nickname: 'My Club', keyword: 'kba & BS U15' })
  })

  it('clearCustomTab removes the saved value', () => {
    saveCustomTab({ nickname: 'x', keyword: 'y' })
    clearCustomTab()
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when JSON is malformed', () => {
    localStorage.setItem('batbracket.customTab', '{not json')
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when stored value is the wrong shape', () => {
    localStorage.setItem('batbracket.customTab', JSON.stringify({ nickname: 'x' }))
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when stored fields are empty strings', () => {
    localStorage.setItem('batbracket.customTab', JSON.stringify({ nickname: '', keyword: '' }))
    expect(loadCustomTab()).toBeNull()
  })

  it('writes under the batbracket.customTab key', () => {
    saveCustomTab({ nickname: 'x', keyword: 'y' })
    expect(localStorage.getItem('batbracket.customTab')).toBe(JSON.stringify({ nickname: 'x', keyword: 'y' }))
  })
})
