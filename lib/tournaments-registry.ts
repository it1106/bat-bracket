import fs from 'fs'
import path from 'path'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'
import { listAllSidecar, lookupByGuid } from '@/lib/providers/bwf/sidecar'
import { dayOf } from '@/lib/presence'
import type { TournamentRef } from '@/lib/types'

interface RegistryEntry extends TournamentRef { done: boolean; name?: string }

let entries: RegistryEntry[] = []
let byGuid: Map<string, RegistryEntry> = new Map()
let rootDir: string = process.cwd()
let lastBuilt = 0

export function _refreshRegistryForTesting(cwd: string): void {
  rootDir = cwd
  buildNow()
}

const DAY_MS = 24 * 60 * 60_000

// A BWF tournament has no "done" marker of its own: it is finished once its
// last day is more than a day behind us (Bangkok time). The extra day covers
// late results and time zones. Without this an ended tournament stayed
// "active" for ever — re-fetched at every boot and holding the headless
// browser open around the clock.
function bwfHasEnded(endDateIso: string | undefined, now: number): boolean {
  return !!endDateIso && /^\d{4}-\d{2}-\d{2}/.test(endDateIso) && endDateIso.slice(0, 10) < dayOf(now - DAY_MS)
}

function buildNow(): void {
  entries = []
  byGuid = new Map()
  const now = Date.now()
  try {
    const txt = fs.readFileSync(path.join(rootDir, 'public', 'tournaments.txt'), 'utf-8')
    const parsed = parseTournamentsTxt(txt)
    for (const e of parsed.manualEntries) {
      const id = e.id.toUpperCase()
      const provider = e.provider ?? 'bat'
      const ref: RegistryEntry = {
        id,
        provider,
        done: (e.done ?? false) || (provider === 'bwf' && bwfHasEnded(lookupByGuid(id)?.endDateIso, now)),
        name: e.name,
      }
      entries.push(ref)
      byGuid.set(ref.id, ref)
    }
    for (const s of listAllSidecar()) {
      const id = s.tournamentCode.toUpperCase()
      if (!byGuid.has(id)) {
        const ref: RegistryEntry = { id, provider: 'bwf', done: bwfHasEnded(s.endDateIso, now), name: s.name }
        entries.push(ref)
        byGuid.set(id, ref)
      }
    }
  } catch (err) {
    console.warn('[registry] build failed:', err)
  }
  lastBuilt = Date.now()
}

const REFRESH_MS = 30_000

function ensureFresh(): void {
  if (Date.now() - lastBuilt > REFRESH_MS) buildNow()
}

export function resolveRef(id: string): TournamentRef | null {
  ensureFresh()
  const upper = id.toUpperCase()
  const e = byGuid.get(upper)
  if (e) return { id: e.id, provider: e.provider }
  return { id: upper, provider: 'bat' }
}

export function listAllTournaments(): RegistryEntry[] {
  ensureFresh()
  return [...entries]
}
