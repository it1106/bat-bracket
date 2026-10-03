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

export function __setBatPlayerRootForTesting(dir: string): void { root = dir; parsed.clear() }

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

// The parsed file per tournament, reused until the file on disk changes. A
// schedule page looks up hundreds of players one by one; re-parsing a file
// that holds them all for each lookup would cost seconds of CPU per page view.
const parsed = new Map<string, { mtimeMs: number; file: PlayerFile }>()

async function readFile(tournamentId: string): Promise<PlayerFile> {
  const dest = cacheFile(tournamentId)
  try {
    const { mtimeMs } = await fs.stat(dest)
    const hit = parsed.get(dest)
    if (hit && hit.mtimeMs === mtimeMs) return hit.file
    const file = JSON.parse(await fs.readFile(dest, 'utf8')) as PlayerFile
    parsed.set(dest, { mtimeMs, file })
    return file
  } catch {
    parsed.delete(dest)
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

// Writes to one tournament's file run one at a time. Each write re-reads the
// file, adds its player and rewrites the whole thing, so two overlapping writes
// would each drop the other's player — and with enough visitors the file never
// fills, so every request scrapes BAT again.
const writeQueues = new Map<string, Promise<void>>()
let tmpSeq = 0

export function writeBatPlayer(
  tournamentId: string,
  playerId: string,
  profile: PlayerProfile,
  done: boolean,
): Promise<void> {
  const dest = cacheFile(tournamentId)
  const prev = writeQueues.get(dest) ?? Promise.resolve()
  const next = prev.then(() => writeNow(tournamentId, playerId, profile, done))
  writeQueues.set(dest, next)
  void next.then(() => { if (writeQueues.get(dest) === next) writeQueues.delete(dest) })
  return next
}

async function writeNow(
  tournamentId: string,
  playerId: string,
  profile: PlayerProfile,
  done: boolean,
): Promise<void> {
  const file = await readFile(tournamentId)
  file.players[playerId] = { profile, ts: Date.now(), ...(done && { done: true as const }) }
  const dest = cacheFile(tournamentId)
  const tmp = `${dest}.${process.pid}.${++tmpSeq}.tmp`
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(file), 'utf8')
    await fs.rename(tmp, dest)
    parsed.set(dest, { mtimeMs: (await fs.stat(dest)).mtimeMs, file })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-player-cache] write failed tournament=${tournamentId} player=${playerId} err=${msg}`)
    try { await fs.unlink(tmp) } catch { /* ignore */ }
  }
}
