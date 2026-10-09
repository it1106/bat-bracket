jest.mock('../lib/tournaments-registry', () => ({ listAllTournaments: jest.fn() }))
jest.mock('../lib/discovery-store', () => ({ loadDiscovered: jest.fn() }))

import { alertTournaments } from '@/lib/push/tournaments'
import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'

const MANUAL = 'AAAAAAAA-0000-0000-0000-000000000001'
const FOUND = 'BBBBBBBB-0000-0000-0000-000000000002'
const BWF = 'CCCCCCCC-0000-0000-0000-000000000003'
const registry = listAllTournaments as jest.Mock
const discovered = loadDiscovered as jest.Mock
const entry = (id: string, hasBracket = true) => ({ id, name: id, hasBracket, discoveredAt: '', lastSeenOnUpcomingAt: '' })

beforeEach(() => {
  registry.mockReset().mockReturnValue([])
  discovered.mockReset().mockResolvedValue({ version: 1, entries: [] })
})

describe('alertTournaments', () => {
  it('is empty when the site lists nothing', async () => {
    expect((await alertTournaments()).size).toBe(0)
  })

  it('includes a BAT tournament listed by hand, with its finished flag', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', done: true }])
    expect((await alertTournaments()).get(MANUAL)).toEqual({ done: true })
  })

  it('includes a tournament the site found by itself — most live ones are', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [entry(FOUND.toLowerCase())] })
    const all = await alertTournaments()
    expect(all.get(FOUND)).toEqual({ done: false })
  })

  it('leaves out a found tournament that has no draws yet', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [entry(FOUND, false)] })
    expect((await alertTournaments()).has(FOUND)).toBe(false)
  })

  it('leaves out BWF tournaments, even one that was also found', async () => {
    registry.mockReturnValue([{ id: BWF, provider: 'bwf', done: false }])
    discovered.mockResolvedValue({ version: 1, entries: [entry(BWF)] })
    expect((await alertTournaments()).has(BWF)).toBe(false)
  })

  it('lets the hand-listed entry decide when a tournament is in both lists', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', done: true }])
    discovered.mockResolvedValue({ version: 1, entries: [entry(MANUAL)] })
    expect((await alertTournaments()).get(MANUAL)).toEqual({ done: true })
  })

  it('never contains an id nobody listed', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', done: false }])
    expect((await alertTournaments()).has('11111111-2222-3333-4444-555555555555')).toBe(false)
  })

  it('still answers from the hand-listed ones when the found list cannot be read', async () => {
    registry.mockReturnValue([{ id: MANUAL, provider: 'bat', done: false }])
    discovered.mockRejectedValue(new Error('EIO'))
    expect((await alertTournaments()).has(MANUAL)).toBe(true)
  })
})
