/**
 * @jest-environment jsdom
 */
import {
  loadCustomTabs,
  saveCustomTabs,
  addCustomTab,
  updateCustomTab,
  deleteCustomTab,
  reorderCustomTabs,
  MAX_CUSTOM_TABS,
} from '@/lib/customTab'

const STORAGE_KEY = 'batbracket.customTabs'
const LEGACY_KEY = 'batbracket.customTab'

beforeEach(() => {
  localStorage.clear()
})

describe('customTab storage — array API', () => {
  it('returns [] when nothing is stored', () => {
    expect(loadCustomTabs()).toEqual([])
  })

  it('round-trips an array', () => {
    const tabs = [
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_b', nickname: 'B', keyword: 'b' },
    ]
    saveCustomTabs(tabs)
    expect(loadCustomTabs()).toEqual(tabs)
  })

  it('returns [] when JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadCustomTabs()).toEqual([])
  })

  it('filters out entries with empty nickname or keyword', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_b', nickname: '', keyword: 'b' },
      { id: 't_c', nickname: 'C', keyword: '' },
      { id: 't_d', nickname: 'D', keyword: 'd' },
    ]))
    expect(loadCustomTabs()).toEqual([
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_d', nickname: 'D', keyword: 'd' },
    ])
  })

  it('caps to MAX_CUSTOM_TABS', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `t_${i}`, nickname: `N${i}`, keyword: `k${i}` }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(many))
    expect(loadCustomTabs()).toHaveLength(MAX_CUSTOM_TABS)
  })

  it('regenerates duplicate ids', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: 'dup', nickname: 'A', keyword: 'a' },
      { id: 'dup', nickname: 'B', keyword: 'b' },
    ]))
    const loaded = loadCustomTabs()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].id).not.toEqual(loaded[1].id)
  })
})

describe('customTab storage — mutators', () => {
  it('addCustomTab appends a new tab with a non-empty id', () => {
    const created = addCustomTab({ nickname: 'A', keyword: 'a' })
    expect(created).not.toBeNull()
    expect(created!.id).toMatch(/^t_/)
    expect(loadCustomTabs()).toEqual([{ id: created!.id, nickname: 'A', keyword: 'a' }])
  })

  it('addCustomTab returns null at MAX_CUSTOM_TABS', () => {
    addCustomTab({ nickname: 'A', keyword: 'a' })
    addCustomTab({ nickname: 'B', keyword: 'b' })
    addCustomTab({ nickname: 'C', keyword: 'c' })
    expect(addCustomTab({ nickname: 'D', keyword: 'd' })).toBeNull()
    expect(loadCustomTabs()).toHaveLength(MAX_CUSTOM_TABS)
  })

  it('updateCustomTab mutates by id', () => {
    const created = addCustomTab({ nickname: 'A', keyword: 'a' })!
    updateCustomTab(created.id, { nickname: 'A2', keyword: 'a2' })
    expect(loadCustomTabs()[0]).toEqual({ id: created.id, nickname: 'A2', keyword: 'a2' })
  })

  it('updateCustomTab is a no-op for unknown id', () => {
    addCustomTab({ nickname: 'A', keyword: 'a' })
    updateCustomTab('does-not-exist', { nickname: 'X', keyword: 'x' })
    expect(loadCustomTabs()[0].nickname).toBe('A')
  })

  it('deleteCustomTab removes by id', () => {
    const a = addCustomTab({ nickname: 'A', keyword: 'a' })!
    addCustomTab({ nickname: 'B', keyword: 'b' })
    deleteCustomTab(a.id)
    const remaining = loadCustomTabs()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].nickname).toBe('B')
  })

  it('reorderCustomTabs writes the requested order', () => {
    const a = addCustomTab({ nickname: 'A', keyword: 'a' })!
    const b = addCustomTab({ nickname: 'B', keyword: 'b' })!
    const c = addCustomTab({ nickname: 'C', keyword: 'c' })!
    reorderCustomTabs([c.id, a.id, b.id])
    expect(loadCustomTabs().map((t) => t.nickname)).toEqual(['C', 'A', 'B'])
  })
})

describe('customTab storage — legacy migration', () => {
  it('migrates a valid legacy single tab', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: 'old', keyword: 'kw' }))
    const tabs = loadCustomTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].nickname).toBe('old')
    expect(tabs[0].keyword).toBe('kw')
    expect(tabs[0].id).toMatch(/^t_/)
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('discards a corrupt legacy value but still removes the key', () => {
    localStorage.setItem(LEGACY_KEY, '{not json')
    expect(loadCustomTabs()).toEqual([])
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('discards a wrong-shape legacy value', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: '', keyword: '' }))
    expect(loadCustomTabs()).toEqual([])
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('migration is idempotent (second load reads only new key)', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: 'old', keyword: 'kw' }))
    loadCustomTabs()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(loadCustomTabs()).toHaveLength(1)
  })
})
