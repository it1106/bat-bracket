import { promises as fs } from 'fs'
import path from 'path'
import type { PlayerProfile } from './types'

// Per-tournament JSON files keyed by playerId. A single bat-player.json shared
// across every tournament would grow to many MB once a few seasons accumulate;
// per-tournament files keep each read small and let done-tournament files sit
// untouched on disk indefinitely.
//
// Shape: { version: 1, players: { [playerId]: { profile, ts, done? } } }
// Entries stamped done=true are served indefinitely; otherwise LIVE_TTL_MS
// gates re-fetch from BAT.

let root = path.join(process.cwd(), '.cache', 'players', 'bat-player')

export function __setBatPlayerRootForTesting(dir: string): void { root = dir }

export const LIVE_TTL_MS = 30 * 60 * 1000

interface PlayerEntry {
  profile: PlayerProfile
  ts: number
  done?: true
}

interface PlayerFile {
  version: 1
  players: Record<string, PlayerEntry>
}

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
}

function cacheFile(tournamentId: string): string {
  return path.join(root, `${safeSegment(tournamentId)}.json`)
}

async function readFile(tournamentId: string): Promise<PlayerFile> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(tournamentId), 'utf8')) as PlayerFile
  } catch {
    return { version: 1, players: {} }
  }
}

export async function readBatPlayer(
  tournamentId: string,
  playerId: string,
): Promise<PlayerEntry | null> {
  const file = await readFile(tournamentId)
  return file.players[playerId] ?? null
}

export function isFresh(entry: PlayerEntry): boolean {
  if (entry.done) return true
  return Date.now() - entry.ts < LIVE_TTL_MS
}

export async function writeBatPlayer(
  tournamentId: string,
  playerId: string,
  profile: PlayerProfile,
  done: boolean,
): Promise<void> {
  const file = await readFile(tournamentId)
  file.players[playerId] = { profile, ts: Date.now(), ...(done && { done: true as const }) }
  const dest = cacheFile(tournamentId)
  const tmp = `${dest}.tmp`
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(file), 'utf8')
    await fs.rename(tmp, dest)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-player-cache] write failed tournament=${tournamentId} player=${playerId} err=${msg}`)
  }
}
