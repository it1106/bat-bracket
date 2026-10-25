/**
 * @jest-environment jsdom
 */
import { lastSeenAnnouncement, markAnnouncementSeen } from '@/lib/announcements'

beforeEach(() => localStorage.clear())

describe('announcement dismissal state', () => {
  it('reports nothing seen to start with', () => {
    expect(lastSeenAnnouncement()).toBeNull()
  })

  it('round-trips the last seen id', () => {
    markAnnouncementSeen('abc123')
    expect(lastSeenAnnouncement()).toBe('abc123')
  })

  it('keeps one key, replacing the previous id', () => {
    markAnnouncementSeen('first')
    markAnnouncementSeen('second')
    expect(lastSeenAnnouncement()).toBe('second')
    expect(Object.keys(localStorage).filter((k) => k.startsWith('batbracket.announcement'))).toEqual(
      ['batbracket.announcementSeen'],
    )
  })

  it('writes under batbracket.announcementSeen', () => {
    markAnnouncementSeen('xyz')
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('xyz')
  })

  it('survives storage that throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => markAnnouncementSeen('x')).not.toThrow()
    spy.mockRestore()
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(lastSeenAnnouncement()).toBeNull()
    get.mockRestore()
  })
})
