import { readFileSync } from 'fs'
import { join } from 'path'
import { parseTournamentsTxt } from './tournaments-txt'

// Cached reader for the manual `# level <GUID> <n>` overrides in
// public/tournaments.txt. Shared by the player-page SSR (and any other level
// consumer) so a tournament whose regulations omit a parseable level still
// shows the correct, human-supplied level. Keyed by uppercased GUID.

let cache: Map<string, number> | null = null
let lastRead = 0
const TTL_MS = 30_000

export function getLevelOverrides(): Map<string, number> {
  const now = Date.now()
  if (cache && now - lastRead < TTL_MS) return cache
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    cache = parseTournamentsTxt(content).levelOverrides
  } catch {
    cache = new Map()
  }
  lastRead = now
  return cache
}
