import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { AnnouncementStore, validateAnnouncement, MAX_ANNOUNCEMENT } from '@/lib/announcement-store'

let dir = ''
let file = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bat-ann-'))
  file = path.join(dir, '.cache', 'announcement.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const store = () => new AnnouncementStore(file)

describe('AnnouncementStore', () => {
  it('reads null when nothing has been written', () => {
    expect(store().read()).toBeNull()
  })

  it('round-trips the text', () => {
    const s = store()
    s.write('ประกาศใหม่')
    expect(s.read()?.text).toBe('ประกาศใหม่')
  })

  it('gives the same id for the same text and a different id for different text', () => {
    const a = store().write('same')!.id
    const b = store().write('same')!.id
    const c = store().write('other')!.id
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('trims, so text differing only in surrounding whitespace keeps its id', () => {
    const a = store().write('hello')!.id
    const s = store()
    expect(s.write('  hello\n')!.id).toBe(a)
    expect(s.read()?.text).toBe('hello')
  })

  it('treats whitespace-only text as off', () => {
    const s = store()
    s.write('something')
    expect(s.write('   \n ')).toBeNull()
    expect(s.read()).toBeNull()
  })

  it('reads null from malformed JSON instead of throwing', () => {
    store().write('x')
    writeFileSync(file, '{ not json', 'utf8')
    expect(store().read()).toBeNull()
  })

  it('sees a write made through another instance', () => {
    const reader = store()
    expect(reader.read()).toBeNull()
    store().write('later')
    expect(reader.read()?.text).toBe('later')
  })

  it('records updatedAt', () => {
    const before = Date.now()
    expect(store().write('x')!.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('validateAnnouncement', () => {
  it('rejects non-strings', () => {
    expect(validateAnnouncement(7)).toEqual({ error: expect.any(String) })
    expect(validateAnnouncement(undefined)).toEqual({ error: expect.any(String) })
  })

  it('accepts the empty string, meaning off', () => {
    expect(validateAnnouncement('')).toEqual({ text: '' })
    expect(validateAnnouncement('   ')).toEqual({ text: '' })
  })

  it('accepts exactly the limit and rejects one over', () => {
    expect(validateAnnouncement('a'.repeat(MAX_ANNOUNCEMENT))).toEqual({ text: 'a'.repeat(MAX_ANNOUNCEMENT) })
    expect(validateAnnouncement('a'.repeat(MAX_ANNOUNCEMENT + 1))).toEqual({ error: expect.any(String) })
  })

  it('measures the limit after trimming', () => {
    expect(validateAnnouncement(`  ${'a'.repeat(MAX_ANNOUNCEMENT)}  `)).toEqual({ text: 'a'.repeat(MAX_ANNOUNCEMENT) })
  })

  it('allows & and | and newlines', () => {
    expect(validateAnnouncement('a & b | c\nd')).toEqual({ text: 'a & b | c\nd' })
  })
})
