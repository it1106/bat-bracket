import fs from 'fs'
import path from 'path'

export interface SidecarEntry {
  tmtId: number
  tournamentCode: string
  slug: string
  name: string
  startDateIso: string
  endDateIso: string
  resolvedAt: string
}

export type Sidecar = Record<string, SidecarEntry>

let filePath: string = path.join(process.cwd(), 'public', 'bwf-cache.json')
let memCache: Sidecar | null = null
let byGuid: Map<string, SidecarEntry> = new Map()
// Whether the last load answered empty because the file could not be read,
// rather than because there is nothing in it. Callers that cache what they
// build from the sidecar — the tournament registry — use this to avoid
// keeping a registry with no BWF tournament in it.
let lastLoadFailed = false

/** True when the most recent loadSidecar() gave up on an unreadable file. */
export function sidecarLoadFailed(): boolean {
  return lastLoadFailed
}

export function resetSidecarForTesting(newPath: string): void {
  filePath = newPath
  memCache = null
  byGuid = new Map()
  lastLoadFailed = false
}

// A read that fails is remembered only when the file is simply not there —
// a settled fact, and one saveSidecarEntry undoes itself when it writes. Any
// other failure (a truncated or unparseable file, a transient IO error) is
// treated as momentary: it answers empty for that call and tries again on
// the next one. Caching it instead cost a whole worker its BWF registry —
// every BWF tournament then resolved as a BAT one, so its players were
// scraped from BAT and its events dropped out of the tournament list until
// the process restarted.
export function loadSidecar(): Sidecar {
  if (memCache) return memCache
  lastLoadFailed = false
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      memCache = {}
      rebuildGuidIndex()
      return memCache
    }
    console.warn('[bwf-sidecar] read failed, will retry:', err)
    lastLoadFailed = true
    return {}
  }
  try {
    memCache = JSON.parse(raw) as Sidecar
  } catch (err) {
    console.warn('[bwf-sidecar] unparseable, will retry:', err)
    lastLoadFailed = true
    return {}
  }
  rebuildGuidIndex()
  return memCache
}

function rebuildGuidIndex(): void {
  byGuid = new Map()
  if (!memCache) return
  for (const entry of Object.values(memCache)) {
    byGuid.set(entry.tournamentCode.toUpperCase(), entry)
  }
}

export function saveSidecarEntry(url: string, entry: SidecarEntry): void {
  loadSidecar()
  memCache![url] = { ...entry, tournamentCode: entry.tournamentCode.toUpperCase() }
  byGuid.set(entry.tournamentCode.toUpperCase(), memCache![url])
  // Write a complete file beside the live one and rename it into place, so a
  // concurrent reader — the tournament registry rebuilds from this file every
  // 30 s — sees either the old file or the new one, never half of one. The
  // temp file is in the same directory because rename is only atomic within
  // one filesystem.
  const tmp = `${filePath}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(memCache, null, 2))
    fs.renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[bwf-sidecar] write failed:', err)
    try { fs.unlinkSync(tmp) } catch { /* nothing to clean up */ }
  }
}

export function lookupByUrl(url: string): SidecarEntry | null {
  return loadSidecar()[url] ?? null
}

export function lookupByGuid(guid: string): SidecarEntry | null {
  loadSidecar()
  return byGuid.get(guid.toUpperCase()) ?? null
}

// The sidecar is keyed by the official bwfbadminton.com tournament page URL, so
// that key is the tournament's public page. Reverse-lookup it by GUID for the
// "official page" link. Returns null when the GUID hasn't been resolved yet.
export function lookupUrlByGuid(guid: string): string | null {
  const sidecar = loadSidecar()
  const target = guid.toUpperCase()
  for (const [url, entry] of Object.entries(sidecar)) {
    if (entry.tournamentCode.toUpperCase() === target) return url
  }
  return null
}

export function listAllSidecar(): SidecarEntry[] {
  return Object.values(loadSidecar())
}
