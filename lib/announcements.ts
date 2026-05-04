export const ANN_CUSTOM_TABS_MULTI = 'customTabs2026-05'
export const ANN_CUSTOM_TABS_MULTI_TEXT_TH =
  '🎉 ฟีเจอร์ใหม่ : สร้าง custom search ได้ถึง 3 ชุด กดเครื่องหมาย + บน tab bar เพื่อทดลองใช้งาน'

const KEY_PREFIX = 'batbracket.announcements.'

export function isAnnouncementDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(KEY_PREFIX + id) === '1'
  } catch {
    return false
  }
}

export function dismissAnnouncement(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY_PREFIX + id, '1')
  } catch {}
}
