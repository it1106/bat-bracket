/**
 * @jest-environment jsdom
 */
import {
  isAnnouncementDismissed,
  dismissAnnouncement,
  ANN_CUSTOM_TABS_MULTI,
  ANN_CUSTOM_TABS_MULTI_TEXT_TH,
} from '@/lib/announcements'

beforeEach(() => {
  localStorage.clear()
})

describe('announcements storage', () => {
  it('returns false when nothing is stored', () => {
    expect(isAnnouncementDismissed('any-id')).toBe(false)
  })

  it('round-trips a dismissal', () => {
    dismissAnnouncement('an-id')
    expect(isAnnouncementDismissed('an-id')).toBe(true)
  })

  it('isolates ids', () => {
    dismissAnnouncement('first')
    expect(isAnnouncementDismissed('first')).toBe(true)
    expect(isAnnouncementDismissed('second')).toBe(false)
  })

  it('writes under the batbracket.announcements.<id> key', () => {
    dismissAnnouncement('demo')
    expect(localStorage.getItem('batbracket.announcements.demo')).toBe('1')
  })

  it('exports the custom-tabs announcement metadata', () => {
    expect(ANN_CUSTOM_TABS_MULTI).toBe('customTabs2026-05')
    expect(ANN_CUSTOM_TABS_MULTI_TEXT_TH).toContain('ฟีเจอร์ใหม่')
    expect(ANN_CUSTOM_TABS_MULTI_TEXT_TH).toContain('custom search')
  })
})
