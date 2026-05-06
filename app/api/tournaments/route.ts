import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import { getTodayIso } from '@/lib/today'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi } from '@/lib/tournaments-merge'
import type { TournamentInfo } from '@/lib/types'

// Force dynamic so auto-done flips and newly-discovered entries are reflected
// on the very next request. Cost is a few file stats per call, trivially cheap.
export const dynamic = 'force-dynamic'

interface ParsedTxt {
  manualEntries: TournamentInfo[]
  denySet: Set<string>
}

const DENY_RE = /^#\s*deny\s+([A-Fa-f0-9-]{36})/

function parseTournamentsTxt(): ParsedTxt {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

    const denySet = new Set<string>()
    const manualEntries: TournamentInfo[] = []

    for (const l of lines) {
      const denyMatch = DENY_RE.exec(l)
      if (denyMatch) {
        denySet.add(denyMatch[1].toUpperCase())
        continue
      }
      if (l.startsWith('#')) continue

      const spaceIdx = l.indexOf(' ')
      if (spaceIdx === -1) {
        manualEntries.push({ id: l.toUpperCase(), name: l })
        continue
      }
      const id = l.slice(0, spaceIdx).toUpperCase()
      const rest = l.slice(spaceIdx + 1).trim()
      const manualDone = rest.endsWith('[done]')
      const name = manualDone ? rest.slice(0, -6).trim() : rest
      manualEntries.push({ id, name, ...(manualDone && { done: true }) })
    }

    return { manualEntries, denySet }
  } catch {
    return { manualEntries: [], denySet: new Set() }
  }
}

async function applyAutoDone(
  entries: TournamentInfo[],
  todayIso: string,
): Promise<TournamentInfo[]> {
  const out: TournamentInfo[] = []
  for (const e of entries) {
    if (e.done) {
      out.push(e)
      continue
    }
    const cached = await readFullCache(e.id)
    if (cached && isAllPast(cached, todayIso)) {
      out.push({ ...e, done: true })
    } else {
      out.push(e)
    }
  }
  return out
}

export async function GET() {
  const { manualEntries, denySet } = parseTournamentsTxt()
  const discovered = await loadDiscovered()
  const merged = mergeForApi(manualEntries, denySet, discovered)
  const todayIso = getTodayIso()
  const final = await applyAutoDone(merged, todayIso)
  return NextResponse.json(final)
}
