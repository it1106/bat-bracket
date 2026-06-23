import { promises as fs } from 'fs'
import path from 'path'
import type { MatchesData } from './types'

export interface TournamentMeta {
  startDateIso?: string
  // BAT tournament level (1-6) parsed from the regulations page. Absent until
  // looked up. `levelChecked` records that a lookup ran so tournaments with no
  // level in their regulations aren't re-fetched on every dropdown load.
  level?: number
  levelChecked?: boolean
}

const META_ROOT = path.join(process.cwd(), '.cache', 'meta')

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function metaPath(id: string): string {
  return path.join(META_ROOT, `${safeSegment(id)}.json`)
}

export async function readMeta(id: string): Promise<TournamentMeta | null> {
  try {
    const buf = await fs.readFile(metaPath(id), 'utf8')
    return JSON.parse(buf) as TournamentMeta
  } catch {
    return null
  }
}

async function writeMeta(id: string, meta: TournamentMeta): Promise<void> {
  const file = metaPath(id)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(meta), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[tournament-meta] write failed tournament=${id} err=${msg}`)
  }
}

// Persist sidecar only when the derived value differs from disk; called from
// every successful full-matches fetch so active tournaments — which never get
// pinned to .cache/full — still expose startDateIso to the dropdown.
export async function persistMetaIfChanged(id: string, data: MatchesData): Promise<void> {
  const startDateIso = data.days[0]?.dateIso
  if (!startDateIso) return
  const prev = await readMeta(id)
  if (prev?.startDateIso === startDateIso) return
  // Merge so a concurrently-written level field isn't clobbered.
  await writeMeta(id, { ...prev, startDateIso })
}

// Read-modify-write a subset of the meta sidecar, preserving other fields.
export async function patchMeta(id: string, patch: Partial<TournamentMeta>): Promise<void> {
  const prev = await readMeta(id)
  await writeMeta(id, { ...prev, ...patch })
}
