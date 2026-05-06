import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import type { TournamentInfo } from '@/lib/types'

export const revalidate = 3600

async function readTournaments(): Promise<TournamentInfo[]> {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    const todayIso = new Date().toISOString().split('T')[0]
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
