import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { DEFAULT_ALIASES, expandSearchQuery, setSearchAliases } from '@/lib/searchAliases'
import { AliasStore, validateAlias } from '@/lib/search-aliases-store'

afterEach(() => setSearchAliases(DEFAULT_ALIASES))

describe('search alias table', () => {
  it('expands the built-in aliases out of the box', () => {
    expect(expandSearchQuery('ren')).toEqual(['ren', 'รวิณ'])
  })

  it('uses a replaced table, still matching keys by prefix', () => {
    setSearchAliases({ smash: 'ทีมสแมช' })
    expect(expandSearchQuery('sma')).toEqual(['sma', 'ทีมสแมช'])
    expect(expandSearchQuery('ren')).toEqual(['ren'])
  })

  it('ignores entries that are not text', () => {
    setSearchAliases({ ok: 'ใช้ได้', bad: 7 as unknown as string })
    expect(expandSearchQuery('ok')).toEqual(['ok', 'ใช้ได้'])
    expect(expandSearchQuery('bad')).toEqual(['bad'])
  })
})

describe('validateAlias', () => {
  it('lower-cases and trims the short name, trims the full name', () => {
    expect(validateAlias('  Ren ', ' รวิณ ')).toEqual({ key: 'ren', value: 'รวิณ' })
  })

  it.each([
    ['r', 'รวิณ', /at least 2/],
    ['', 'รวิณ', /at least 2/],
    ['ren', '   ', /full name/i],
    ['a&b', 'x', /& or \|/],
    ['ab', 'x|y', /& or \|/],
    ['x'.repeat(41), 'y', /40/],
    ['ab', 'y'.repeat(101), /100/],
    [5, 'y', /text/i],
  ])('rejects %p -> %p', (key, value, message) => {
    expect(validateAlias(key, value)).toEqual({ error: expect.stringMatching(message) })
  })
})

describe('AliasStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'aliases-'))
    file = path.join(dir, 'nested', 'search-aliases.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('starts with the built-in aliases and writes nothing until changed', () => {
    const store = new AliasStore(file)
    expect(store.list()).toEqual(DEFAULT_ALIASES)
    expect(existsSync(file)).toBe(false)
  })

  it('adds an alias and keeps it across a restart', () => {
    new AliasStore(file).set('smash', 'ทีมสแมช')
    const again = new AliasStore(file)
    expect(again.list()).toMatchObject({ ...DEFAULT_ALIASES, smash: 'ทีมสแมช' })
    expect(JSON.parse(readFileSync(file, 'utf8')).aliases.smash).toBe('ทีมสแมช')
  })

  it('replaces an existing alias', () => {
    const store = new AliasStore(file)
    store.set('ren', 'เรน')
    expect(new AliasStore(file).list().ren).toBe('เรน')
  })

  it('removes an alias for good, including a built-in one', () => {
    const store = new AliasStore(file)
    expect(store.remove('ren')).toBe(true)
    expect(store.remove('ren')).toBe(false)
    expect('ren' in new AliasStore(file).list()).toBe(false)
  })

  it('sees a change made by another store on the same file', () => {
    const a = new AliasStore(file)
    const b = new AliasStore(file)
    a.list()
    b.set('smash', 'ทีมสแมช')
    expect(a.list().smash).toBe('ทีมสแมช')
  })

  it('falls back to the built-ins when the file is corrupt', () => {
    new AliasStore(file).set('smash', 'ทีมสแมช')
    require('fs').writeFileSync(file, '{nope', 'utf8')
    expect(new AliasStore(file).list()).toEqual(DEFAULT_ALIASES)
  })
})
