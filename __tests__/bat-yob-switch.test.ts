jest.mock('../lib/bat-player-fetch', () => ({
  fetchBatPlayerProfile: jest.fn(),
}))
jest.mock('../lib/bat-player-cache', () => ({
  readBatPlayer: jest.fn(async () => ({ profile: { yob: '2011' }, ts: Date.now() })),
  isFresh: jest.fn(() => true),
}))

import { BAT_YOB_LOOKUP_ENABLED } from '@/lib/bat-yob-switch'
import { fetchBatPlayerProfile } from '@/lib/bat-player-fetch'
import { readBatPlayer } from '@/lib/bat-player-cache'
import { GET, POST } from '@/app/api/bat/player-ages/route'

describe('/api/bat/player-ages with the birth-year lookup switched off', () => {
  it('is switched off', () => {
    expect(BAT_YOB_LOOKUP_ENABLED).toBe(false)
  })

  it('answers for nobody and never asks BAT', async () => {
    const post = await POST(new Request('http://localhost/api/bat/player-ages', {
      method: 'POST',
      body: JSON.stringify({ tournament: 'T1', ids: ['1', '2'] }),
    }))
    const get = await GET(new Request('http://localhost/api/bat/player-ages?tournament=T1&ids=1,2'))
    expect(post.status).toBe(200)
    expect(await post.json()).toEqual({})
    expect(await get.json()).toEqual({})
    expect(readBatPlayer).not.toHaveBeenCalled()
    expect(fetchBatPlayerProfile).not.toHaveBeenCalled()
  })
})
