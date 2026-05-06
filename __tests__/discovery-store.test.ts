import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadDiscovered, saveDiscovered, type DiscoveryStore } from '@/lib/discovery-store'

describe('discovery-store', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-disc-'))
    process.chdir(tmpRoot)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('loadDiscovered returns empty store when file does not exist', async () => {
    const store = await loadDiscovered()
    expect(store).toEqual({ version: 1, entries: [] })
  })

  it('saveDiscovered then loadDiscovered round-trips', async () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'AAAAAAAA-1111-2222-3333-444444444444',
          name: 'Test Open',
          hasBracket: true,
          discoveredAt: '2026-05-01T00:00:00Z',
          lastSeenOnUpcomingAt: '2026-05-07T03:00:00Z',
        },
      ],
    }
    await saveDiscovered(store)
    const loaded = await loadDiscovered()
    expect(loaded).toEqual(store)
  })

  it('saveDiscovered does not leave .tmp files behind', async () => {
    await saveDiscovered({ version: 1, entries: [] })
    const tmpFiles = fs
      .readdirSync(path.join(tmpRoot, '.cache'))
      .filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toEqual([])
  })

  it('loadDiscovered returns empty store on corrupt JSON', async () => {
    const file = path.join(tmpRoot, '.cache', 'discovered-tournaments.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    const store = await loadDiscovered()
    expect(store).toEqual({ version: 1, entries: [] })
  })
})
