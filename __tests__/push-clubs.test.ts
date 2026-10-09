jest.mock('../lib/bracket-cache', () => ({ playerClubCache: new Map<string, string>() }))
jest.mock('../lib/clubs-cache', () => ({ readClubsCache: jest.fn() }))

import { clubLookup } from '@/lib/push/clubs'
import { playerClubCache } from '@/lib/bracket-cache'
import { readClubsCache } from '@/lib/clubs-cache'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const disk = readClubsCache as jest.Mock
const mem = playerClubCache as Map<string, string>

beforeEach(() => { mem.clear(); disk.mockReset().mockResolvedValue(null) })

describe('clubLookup', () => {
  it('knows nobody when nothing is held', async () => {
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBeUndefined()
    expect(c.hasClub('Red Club')).toBe(false)
  })

  it('reads the disk copy', async () => {
    disk.mockResolvedValue({ '1': 'Red Club' })
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBe('Red Club')
    expect(c.hasClub(' red  CLUB')).toBe(true)
    expect(c.hasClub('Blue Club')).toBe(false)
  })

  it('prefers the in-memory copy, which is fresher, and finds its clubs too', async () => {
    disk.mockResolvedValue({ '1': 'Old Club' })
    mem.set(`${TID.toLowerCase()}:1`, 'New Club')
    mem.set(`${TID.toLowerCase()}:2`, 'Blue Club')
    mem.set('bbbbbbbb-0000-0000-0000-000000000002:3', 'Other Tournament Club')
    const c = await clubLookup(TID)
    expect(c.clubOf('1')).toBe('New Club')
    expect(c.clubOf('2')).toBe('Blue Club')
    expect(c.hasClub('blue club')).toBe(true)
    expect(c.hasClub('Other Tournament Club')).toBe(false)
  })

  it('still answers when the disk read fails', async () => {
    disk.mockRejectedValue(new Error('EIO'))
    mem.set(`${TID.toLowerCase()}:1`, 'Red Club')
    expect((await clubLookup(TID)).clubOf('1')).toBe('Red Club')
  })
})
