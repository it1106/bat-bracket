import { promises as fs } from 'fs'
import path from 'path'

let root = path.join(process.cwd(), '.cache', 'clubs')

export function __setClubsRootForTesting(dir: string): void { root = dir }

function safeSegment(s: string): string { return s.replace(/[^a-zA-Z0-9_-]/g, '_') }
function clubsPath(id: string): string { return path.join(root, `${safeSegment(id)}.json`) }

export async function readClubsCache(tournamentId: string): Promise<Record<string, string> | null> {
  try {
    const buf = await fs.readFile(clubsPath(tournamentId), 'utf8')
    return JSON.parse(buf) as Record<string, string>
  } catch { return null }
}

export async function writeClubsCache(tournamentId: string, clubs: Record<string, string>): Promise<void> {
  const file = clubsPath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(clubs), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[clubs-cache] write failed id=${tournamentId} err=${msg}`)
  }
}
