export interface CustomTab {
  id: string
  nickname: string
  keyword: string
}

export const MAX_CUSTOM_TABS = 3

const STORAGE_KEY = 'batbracket.customTabs'
const LEGACY_KEY = 'batbracket.customTab'

function genId(): string {
  return 't_' + Math.random().toString(36).slice(2, 10)
}

function isValidEntry(v: unknown): v is { id: unknown; nickname: string; keyword: string } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.nickname === 'string' && o.nickname.length > 0
    && typeof o.keyword === 'string' && o.keyword.length > 0
}

function normalize(arr: unknown): CustomTab[] {
  if (!Array.isArray(arr)) return []
  const out: CustomTab[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!isValidEntry(item)) continue
    let id = typeof item.id === 'string' && item.id.length > 0 ? item.id : genId()
    if (seen.has(id)) id = genId()
    seen.add(id)
    out.push({ id, nickname: item.nickname, keyword: item.keyword })
    if (out.length >= MAX_CUSTOM_TABS) break
  }
  return out
}

function readRaw(): CustomTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    return normalize(JSON.parse(raw))
  } catch {
    return []
  }
}

function migrateLegacy(current: CustomTab[]): CustomTab[] {
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy === null) return current
  let migrated: CustomTab[] = current
  try {
    const parsed = JSON.parse(legacy)
    if (
      typeof parsed === 'object' && parsed !== null
      && typeof (parsed as { nickname?: unknown }).nickname === 'string'
      && typeof (parsed as { keyword?: unknown }).keyword === 'string'
      && (parsed as { nickname: string }).nickname.length > 0
      && (parsed as { keyword: string }).keyword.length > 0
    ) {
      const tab: CustomTab = {
        id: genId(),
        nickname: (parsed as { nickname: string }).nickname,
        keyword: (parsed as { keyword: string }).keyword,
      }
      migrated = normalize([tab, ...current])
    }
  } catch {}
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
  if (migrated !== current) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)) } catch {}
  }
  return migrated
}

export function loadCustomTabs(): CustomTab[] {
  if (typeof window === 'undefined') return []
  const current = readRaw()
  return migrateLegacy(current)
}

export function saveCustomTabs(tabs: CustomTab[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.slice(0, MAX_CUSTOM_TABS)))
  } catch {}
}

export function addCustomTab(input: { nickname: string; keyword: string }): CustomTab | null {
  const tabs = loadCustomTabs()
  if (tabs.length >= MAX_CUSTOM_TABS) return null
  const created: CustomTab = { id: genId(), nickname: input.nickname, keyword: input.keyword }
  saveCustomTabs([...tabs, created])
  return created
}

export function updateCustomTab(id: string, patch: { nickname: string; keyword: string }): void {
  const tabs = loadCustomTabs()
  const next = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
  saveCustomTabs(next)
}

export function deleteCustomTab(id: string): void {
  const tabs = loadCustomTabs()
  saveCustomTabs(tabs.filter((t) => t.id !== id))
}

export function reorderCustomTabs(orderedIds: string[]): void {
  const tabs = loadCustomTabs()
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const reordered: CustomTab[] = []
  for (const id of orderedIds) {
    const t = byId.get(id)
    if (t && !seen.has(id)) { reordered.push(t); seen.add(id) }
  }
  for (const t of tabs) {
    if (!seen.has(t.id)) reordered.push(t)
  }
  saveCustomTabs(reordered)
}
