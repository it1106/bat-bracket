import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import { getTodayIso } from '@/lib/today'
import type { TournamentInfo } from '@/lib/types'

// Force dynamic so auto-done flips (disk cache appearing for a tournament
// whose last day has just passed) are reflected on the very next request.
// Cost is ~4 file reads per call (one stat per tournament), which is trivial.
export const dynamic = 'force-dynamic'

async function readTournaments(): Promise<TournamentInfo[]> {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    const todayIso = getTodayIso()
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))

    const out: TournamentInfo[] = []
    for (const l of lines) {
      const spaceIdx = l.indexOf(' ')
      if (spaceIdx === -1) {
        out.push({ id: l.toUpperCase(), name: l })
        continue
      }
      const id = l.slice(0, spaceIdx).toUpperCase()
      const rest = l.slice(spaceIdx + 1).trim()
      const manualDone = rest.endsWith('[done]')
      const name = manualDone ? rest.slice(0, -6).trim() : rest

      // Auto-promote to "done" once every match-day is strictly before today.
      // Falls back to the manual [done] marker for tournaments without a
      // pinned full schedule (e.g. one that never published one).
      let done = manualDone
      if (!done) {
        const cached = await readFullCache(id)
        if (cached && isAllPast(cached, todayIso)) done = true
      }
      out.push({ id, name, ...(done && { done: true }) })
    }
    return out
  } catch {
    return []
  }
}

export async function GET() {
  return NextResponse.json(await readTournaments())
}
