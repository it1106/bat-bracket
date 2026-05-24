import fs from 'fs'
import path from 'path'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'
import { listAllSidecar } from '@/lib/providers/bwf/sidecar'
import type { TournamentRef, ProviderTag } from '@/lib/types'

interface RegistryEntry extends TournamentRef { done: boolean }

let entries: RegistryEntry[] = []
let byGuid: Map<string, RegistryEntry> = new Map()
let rootDir: string = process.cwd()
let lastBuilt = 0

export function _refreshRegistryForTesting(cwd: string): void {
  rootDir = cwd
  buildNow()
}

function buildNow(): void {
  entries = []
  byGuid = new Map()
  try {
    const txt = fs.readFileSync(path.join(rootDir, 'public', 'tournaments.txt'), 'utf-8')
    const parsed = parseTournamentsTxt(txt)
    for (const e of parsed.manualEntries) {
      const ref: RegistryEntry = {
        id: e.id.toUpperCase(),
        provider: e.provider ?? 'bat',
        done: e.done ?? false,
      }
      entries.push(ref)
      byGuid.set(ref.id, ref)
    }
    for (const s of listAllSidecar()) {
      const id = s.tournamentCode.toUpperCase()
      if (!byGuid.has(id)) {
        const ref: RegistryEntry = { id, provider: 'bwf', done: false }
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

export function listDoneByProvider(provider: ProviderTag): RegistryEntry[] {
  ensureFresh()
  return entries.filter(e => e.provider === provider && e.done)
}
