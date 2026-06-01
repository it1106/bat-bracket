import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
  __setBatPlayerIdMapRootForTesting,
} from '@/lib/bat-player-id-map'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-player-id-map-'))
  __setBatPlayerIdMapRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('bat-player-id-map', () => {
  it('returns null for an unseen slug', async () => {
    expect(await readPlayerIdEntry('foo')).toBeNull()
  })

  it('persists and reads a success', async () => {
    await writePlayerIdSuccess('ravin', '3903158')
    expect(await readPlayerIdEntry('ravin')).toEqual({ globalPlayerId: '3903158' })
  })

  it('persists and reads a failure sentinel', async () => {
    await writePlayerIdFailure('ghost', 'upstream 404')
    expect(await readPlayerIdEntry('ghost')).toEqual({ globalPlayerId: null, reason: 'upstream 404' })
  })

  it('a later success overwrites an earlier failure for the same slug', async () => {
    await writePlayerIdFailure('flaky', 'transient')
    await writePlayerIdSuccess('flaky', '42')
    expect(await readPlayerIdEntry('flaky')).toEqual({ globalPlayerId: '42' })
  })

  it('preserves other slugs across writes', async () => {
    await writePlayerIdSuccess('a', '1')
    await writePlayerIdSuccess('b', '2')
    expect(await readPlayerIdEntry('a')).toEqual({ globalPlayerId: '1' })
    expect(await readPlayerIdEntry('b')).toEqual({ globalPlayerId: '2' })
  })

  it('returns null on corrupt file', async () => {
    await fs.writeFile(path.join(tmp, 'bat-player-id-map.json'), '{not json')
    expect(await readPlayerIdEntry('whatever')).toBeNull()
  })
})
