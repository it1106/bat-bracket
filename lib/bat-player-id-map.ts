import { promises as fs } from 'fs'
import path from 'path'
import type { BatPlayerIdMap } from './types'

// Single-file slug → BAT ranking player id map. Append-only on success;
// failures are persisted as { globalPlayerId: null, reason } so the
// discovery route doesn't re-hit every page view.
//
// Since BAT split its ranking into two series (Open rid=289, Junior
// rid=189) a player carries a *different* numeric id in each, so entries
// store `bySeries` alongside a primary id. v1 files hold ids from the
// retired rid=188 list, which upstream no longer resolves — they are
// dropped wholesale on read so every slug re-discovers once.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatPlayerIdMapRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-player-id-map.json') }

async function readAll(): Promise<BatPlayerIdMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatPlayerIdMap
    if (parsed.version !== 2 || !parsed.players) return { version: 2, players: {} }
    return parsed
  } catch {
    return { version: 2, players: {} }
  }
}

async function writeAll(map: BatPlayerIdMap): Promise<void> {
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(map), 'utf8')
  await fs.rename(tmp, file)
}

export type PlayerIdEntry =
  | { globalPlayerId: string; bySeries: Record<string, string> }
  | { globalPlayerId: null; reason?: string }

export async function readPlayerIdEntry(slug: string): Promise<PlayerIdEntry | null> {
  const map = await readAll()
  const entry = map.players[slug]
  if (!entry) return null
  if (entry.globalPlayerId === null) return { globalPlayerId: null, reason: entry.reason }
  return {
    globalPlayerId: entry.globalPlayerId,
    // Pre-split entries have no bySeries; treat the primary id as unattributed
    // and let the caller fall back to the snapshot's primary publication.
    bySeries: entry.bySeries ?? {},
  }
}

/** Persist a successful discovery. `bySeries` maps series id (`rid`) → that
 *  series' numeric player id; the primary id is the first one listed. */
export async function writePlayerIdSuccess(
  slug: string,
  globalPlayerId: string,
  bySeries: Record<string, string> = {},
): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId, bySeries }
  await writeAll(map)
}

export async function writePlayerIdFailure(slug: string, reason: string): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId: null, reason }
  await writeAll(map)
}
