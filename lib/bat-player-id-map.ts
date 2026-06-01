import { promises as fs } from 'fs'
import path from 'path'
import type { BatPlayerIdMap } from './types'

// Single-file slug → BAT global player id map. Append-only on success;
// failures are persisted as { globalPlayerId: null, reason } so the
// discovery route doesn't re-hit every page view.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatPlayerIdMapRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-player-id-map.json') }

async function readAll(): Promise<BatPlayerIdMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatPlayerIdMap
    if (parsed.version !== 1 || !parsed.players) return { version: 1, players: {} }
    return parsed
  } catch {
    return { version: 1, players: {} }
  }
}

async function writeAll(map: BatPlayerIdMap): Promise<void> {
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(map), 'utf8')
  await fs.rename(tmp, file)
}

export async function readPlayerIdEntry(
  slug: string,
): Promise<{ globalPlayerId: string } | { globalPlayerId: null; reason?: string } | null> {
  const map = await readAll()
  const entry = map.players[slug]
  if (!entry) return null
  if (entry.globalPlayerId === null) return { globalPlayerId: null, reason: entry.reason }
  return { globalPlayerId: entry.globalPlayerId }
}

export async function writePlayerIdSuccess(slug: string, globalPlayerId: string): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId }
  await writeAll(map)
}

export async function writePlayerIdFailure(slug: string, reason: string): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId: null, reason }
  await writeAll(map)
}
