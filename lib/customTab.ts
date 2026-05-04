export interface CustomTab {
  nickname: string
  keyword: string
}

const STORAGE_KEY = 'batbracket.customTab'

function isValid(v: unknown): v is CustomTab {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.nickname === 'string' && o.nickname.length > 0
    && typeof o.keyword === 'string' && o.keyword.length > 0
}

export function loadCustomTab(): CustomTab | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveCustomTab(tab: CustomTab): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tab))
  } catch {}
}

export function clearCustomTab(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
