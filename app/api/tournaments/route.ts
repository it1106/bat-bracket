import { NextResponse } from 'next/server'
import { parseTournamentMeta } from '@/lib/scraper'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { TournamentInfo } from '@/lib/types'

export const revalidate = 3600 // 1 hour

function readTournamentIds(): string[] {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(/\s+/)[0]) // take only first token (the GUID)
  } catch {
    return []
  }
}

async function fetchTournamentName(guid: string): Promise<string> {
  const url = `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${guid}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  })
  if (!res.ok) return guid
  const html = await res.text()
  const meta = parseTournamentMeta(html)
  return meta?.name ?? guid
}

export async function GET() {
  const ids = readTournamentIds()
  if (ids.length === 0) {
    return NextResponse.json([])
  }

  const results: TournamentInfo[] = await Promise.all(
    ids.map(async (id) => {
      const name = await fetchTournamentName(id).catch(() => id)
      return { id: id.toUpperCase(), name }
    })
  )

  return NextResponse.json(results)
}
