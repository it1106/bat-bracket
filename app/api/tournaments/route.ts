import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { TournamentInfo } from '@/lib/types'

export const revalidate = 3600

function readTournaments(): TournamentInfo[] {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const spaceIdx = l.indexOf(' ')
        if (spaceIdx === -1) return { id: l.toUpperCase(), name: l }
        const id = l.slice(0, spaceIdx).toUpperCase()
        const rest = l.slice(spaceIdx + 1).trim()
        const done = rest.endsWith('[done]')
        const name = done ? rest.slice(0, -6).trim() : rest
        return { id, name, ...(done && { done: true }) }
      })
  } catch {
    return []
  }
}

export async function GET() {
  return NextResponse.json(readTournaments())
}
