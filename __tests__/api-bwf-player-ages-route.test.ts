jest.mock('../lib/bwf-player-dob-cache', () => ({ getPlayerDobs: jest.fn(), hasUnknownDobs: jest.fn() }))

import { getPlayerDobs, hasUnknownDobs } from '@/lib/bwf-player-dob-cache'
import { GET } from '@/app/api/bwf/player-ages/route'

const get = (ids: string) => GET(new Request(`http://localhost/api/bwf/player-ages?ids=${encodeURIComponent(ids)}`))
const asked = () => (getPlayerDobs as jest.Mock).mock.calls[0][0] as string[]

beforeEach(() => {
  jest.resetAllMocks()
  ;(getPlayerDobs as jest.Mock).mockResolvedValue({})
  ;(hasUnknownDobs as jest.Mock).mockResolvedValue(true)
})

describe('GET /api/bwf/player-ages', () => {
  it('answers with age and date of birth for the players it knows', async () => {
    ;(getPlayerDobs as jest.Mock).mockResolvedValue({ '86870': '2013-06-06', '57971': null })
    const body = await (await get('86870,57971')).json()
    expect(body['86870'].dob).toBe('2013-06-06')
    expect(typeof body['86870'].age).toBe('number')
    expect(body['57971']).toEqual({ age: null, dob: null })
  })

  // Absent, not null: null means BWF has no date of birth for the player, and
  // the page would stop asking.
  it('leaves out a player it has not been able to look up yet', async () => {
    ;(getPlayerDobs as jest.Mock).mockResolvedValue({ '86870': '2013-06-06' })
    const body = await (await get('86870,57971')).json()
    expect(Object.keys(body)).toEqual(['86870'])
  })

  it('passes on only ids that are player numbers, each once', async () => {
    await get('86870, 57971,86870,abc,1/../2,12345678901234567890,-5,')
    expect(asked()).toEqual(['86870', '57971'])
  })

  it('takes at most 400 ids from one request', async () => {
    await get(Array.from({ length: 1000 }, (_, i) => String(10000 + i)).join(','))
    expect(asked()).toHaveLength(400)
    expect(asked()[399]).toBe('10399')
  })

  it('asks for nothing when no id is a player number', async () => {
    const res = await get('abc,../x')
    expect(await res.json()).toEqual({})
    expect(getPlayerDobs).not.toHaveBeenCalled()
  })
})
