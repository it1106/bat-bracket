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

export function resetSidecarForTesting(newPath: string): void {
  filePath = newPath
  memCache = null
  byGuid = new Map()
}

export function loadSidecar(): Sidecar {
  if (memCache) return memCache
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    memCache = JSON.parse(raw) as Sidecar
  } catch {
    memCache = {}
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
  try {
    fs.writeFileSync(filePath, JSON.stringify(memCache, null, 2))
  } catch (err) {
    console.warn('[bwf-sidecar] write failed:', err)
  }
}

export function lookupByUrl(url: string): SidecarEntry | null {
  return loadSidecar()[url] ?? null
}

export function lookupByGuid(guid: string): SidecarEntry | null {
  loadSidecar()
  return byGuid.get(guid.toUpperCase()) ?? null
}

export function listAllSidecar(): SidecarEntry[] {
  return Object.values(loadSidecar())
}
