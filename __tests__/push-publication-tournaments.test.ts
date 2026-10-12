jest.mock('../lib/discovery-store', () => ({ loadDiscovered: jest.fn() }))
jest.mock('../lib/tournaments-txt', () => ({ parseTournamentsTxt: jest.fn() }))

import { publicationTournaments } from '@/lib/push/tournaments'
import { loadDiscovered } from '@/lib/discovery-store'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'

const MANUAL = 'AAAAAAAA-0000-0000-0000-000000000001'
const FOUND = 'BBBBBBBB-0000-0000-0000-000000000002'
const BWF = 'CCCCCCCC-0000-0000-0000-000000000003'
const DENIED = 'DDDDDDDD-0000-0000-0000-000000000004'

const discovered = loadDiscovered as jest.Mock
const parsed = parseTournamentsTxt as jest.Mock
const found = (id: string, name: string, hasBracket = true) => ({ id, name, hasBracket, discoveredAt: '', lastSeenOnUpcomingAt: '' })

const txt = (over: Record<string, unknown> = {}) => ({
  manualEntries: [], denySet: new Set<string>(), denyNamePatterns: [], levelOverrides: new Map(), ...over,
})

beforeEach(() => {
  parsed.mockReset().mockReturnValue(txt())
  discovered.mockReset().mockResolvedValue({ version: 1, entries: [] })
})

describe('publicationTournaments', () => {
  it('is empty when the site lists nothing', async () => {
    expect(await publicationTournaments()).toEqual([])
  })

  it('gives a hand-listed BAT tournament with its name and finished flag, id upper-cased', async () => {
    parsed.mockReturnValue(txt({ manualEntries: [{ id: MANUAL.toLowerCase(), name: 'THE MALL 2026', done: true }] }))
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'THE MALL 2026', done: true }])
  })

  it('gives a discovered tournament whose draws are out', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [found(FOUND.toLowerCase(), 'Found Open')] })
    expect(await publicationTournaments()).toEqual([{ id: FOUND, name: 'Found Open', done: false }])
  })

  it('leaves out a discovered tournament the site does not show yet', async () => {
    discovered.mockResolvedValue({ version: 1, entries: [found(FOUND, 'Not ready', false)] })
    expect(await publicationTournaments()).toEqual([])
  })

  it('leaves out a tournament the deny set or a name pattern excludes', async () => {
    parsed.mockReturnValue(txt({ denySet: new Set([DENIED]), denyNamePatterns: ['veteran'] }))
    discovered.mockResolvedValue({ version: 1, entries: [found(DENIED, 'Denied Cup'), found(FOUND, 'Veteran Masters')] })
    expect(await publicationTournaments()).toEqual([])
  })

  it('leaves out BWF tournaments', async () => {
    parsed.mockReturnValue(txt({ manualEntries: [{ id: BWF, name: 'A BWF event', provider: 'bwf' }] }))
    expect(await publicationTournaments()).toEqual([])
  })

  it('lets the hand-listed entry decide when a tournament is in both lists', async () => {
    parsed.mockReturnValue(txt({ manualEntries: [{ id: MANUAL, name: 'Hand name', done: true }] }))
    discovered.mockResolvedValue({ version: 1, entries: [found(MANUAL, 'Found name')] })
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'Hand name', done: true }])
  })

  it('answers from the hand-listed ones alone when the found list cannot be read', async () => {
    parsed.mockReturnValue(txt({ manualEntries: [{ id: MANUAL, name: 'THE MALL 2026' }] }))
    discovered.mockRejectedValue(new Error('EIO'))
    expect(await publicationTournaments()).toEqual([{ id: MANUAL, name: 'THE MALL 2026', done: false }])
  })

  it('is empty, not a throw, when tournaments.txt cannot be read', async () => {
    parsed.mockImplementation(() => { throw new Error('ENOENT') })
    expect(await publicationTournaments()).toEqual([])
  })
})
