import { promises as fs } from 'fs'
import path from 'path'

export interface DiscoveredEntry {
  id: string
  name: string
  hasBracket: boolean
  discoveredAt: string
  lastSeenOnUpcomingAt: string
}

export interface DiscoveryStore {
  version: 1
  entries: DiscoveredEntry[]
}

const FILE_PATH = () =>
  path.join(process.cwd(), '.cache', 'discovered-tournaments.json')

const EMPTY: DiscoveryStore = { version: 1, entries: [] }

export async function loadDiscovered(): Promise<DiscoveryStore> {
  try {
    const buf = await fs.readFile(FILE_PATH(), 'utf8')
    const parsed = JSON.parse(buf) as DiscoveryStore
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed
    }
    return EMPTY
  } catch {
    return EMPTY
  }
}

export async function saveDiscovered(store: DiscoveryStore): Promise<void> {
  const file = FILE_PATH()
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[discovery-store] write failed: ${msg}`)
    try {
      await fs.unlink(tmp)
    } catch {
      // ignore
    }
  }
}
