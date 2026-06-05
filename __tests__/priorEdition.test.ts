import { resolvePriorEdition, buildPriorEditionWinners } from '@/lib/priorEdition'
import type { TournamentInfo } from '@/lib/types'

const T = (id: string, name: string, dateIso: string, done = true): TournamentInfo => ({ id, name, done, startDateIso: dateIso })

describe('resolvePriorEdition', () => {
  test('returns null when no candidates', () => {
    expect(resolvePriorEdition('CURRENT-2026', 'Yonex Singha BAT BTY', [])).toBeNull()
  })

  test('picks the most recent done prior with matching canonical name', () => {
    const current = T('YONEX-SINGHA-BAT-BTY-2026', 'Yonex Singha BAT BTY 2026', '2026-06-10')
    const all: TournamentInfo[] = [
      T('YONEX-SINGHA-BAT-BTY-2024', 'Yonex Singha BAT BTY 2024', '2024-06-12'),
      T('YONEX-SINGHA-BAT-BTY-2025', 'Yonex Singha BAT BTY 2025', '2025-06-11'),
      T('UNRELATED-2025', 'Other Open 2025', '2025-07-01'),
    ]
    expect(resolvePriorEdition(current.id, current.name, all)?.id).toBe('YONEX-SINGHA-BAT-BTY-2025')
  })

  test('falls back to id-prefix when name match yields zero', () => {
    const current = T('FOO-BAR-2026', 'Different Display 2026', '2026-06-10')
    const all: TournamentInfo[] = [T('FOO-BAR-2025', 'Different Display 2025', '2025-06-10')]
    expect(resolvePriorEdition(current.id, current.name, all)?.id).toBe('FOO-BAR-2025')
  })

  test('returns null when name match is ambiguous', () => {
    const current = T('A-2026', 'Open 2026', '2026-06-10')
    const all: TournamentInfo[] = [
      T('A-2025', 'Open 2025', '2025-06-10'),
      T('B-2025', 'Open 2025', '2025-06-10'),
    ]
    expect(resolvePriorEdition(current.id, current.name, all)).toBeNull()
  })

  test('excludes the current tournament from candidates', () => {
    const current = T('SAME-2026', 'Repeat 2026', '2026-06-10')
    expect(resolvePriorEdition(current.id, current.name, [current])).toBeNull()
  })
})

describe('buildPriorEditionWinners', () => {
  test('returns empty map when prior is null', () => {
    expect(buildPriorEditionWinners(null, new Map(), {}).size).toBe(0)
  })

  test('returns one entry per event the prior edition has a winner for', () => {
    const prior = T('PRI-2025', 'Prior 2025', '2025-06-10')
    const winners = new Map<string, { players: string[] }>([
      ['MS', { players: ['p1'] }],
      ['WS', { players: ['q1'] }],
    ])
    const out = buildPriorEditionWinners(prior, winners, { p1: 'A', q1: 'B' })
    expect(out.get('MS')).toEqual({
      players: ['p1'],
      club: 'A',
      priorEditionId: 'PRI-2025',
      priorEditionLabel: 'Prior 2025',
    })
    expect(out.get('WS')?.club).toBe('B')
  })
})
