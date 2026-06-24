import { parseTournamentsTxt } from '@/lib/tournaments-txt'

const MIXED_INPUT = `
# BAT Thailand Tournament IDs
# Format: GUID Tournament Name

4526a530-2091-4932-adab-b0a9b1fff98e SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026
1BEC8194-C338-4CB0-AA1D-7444C90F5DE6 Trang Yonex Open 2026 Presented by Pumpui [done]
D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC โตโยต้า เยาวชนชิงชนะเลิศแห่งประเทศไทย ประจำปี 2569 [done]
# deny 11111111-2222-3333-4444-555555555555

@bwf https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026/
@bwf https://bwfbadminton.com/tournament/5670/baoji-china-masters-2026/ [done]
`.trim()

describe('parseTournamentsTxt', () => {
  it('BAT-shaped lines produce identical output to legacy parser', () => {
    const { manualEntries, denySet } = parseTournamentsTxt(MIXED_INPUT)
    const batEntries = manualEntries.filter((e) => !e.provider || e.provider === 'bat')
    expect(batEntries).toEqual([
      { id: '4526A530-2091-4932-ADAB-B0A9B1FFF98E', name: 'SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026' },
      { id: '1BEC8194-C338-4CB0-AA1D-7444C90F5DE6', name: 'Trang Yonex Open 2026 Presented by Pumpui', done: true },
      { id: 'D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC', name: 'โตโยต้า เยาวชนชิงชนะเลิศแห่งประเทศไทย ประจำปี 2569', done: true },
    ])
    expect(Array.from(denySet)).toEqual(['11111111-2222-3333-4444-555555555555'])
  })

  it('parses "# level <GUID> <n>" directives into an uppercased override map', () => {
    const input = [
      '# level a2812d92-b33f-4f37-ac72-3310bb1be0f1 1',
      '#level 66F4AF24-4FC2-4D05-9ACB-986F157A1978 1',
      '# level D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC 2',
      '# level not-a-guid 3',
      '# level 11111111-2222-3333-4444-555555555555 9',
      '# level aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee 1   # with trailing comment',
    ].join('\n')
    const { levelOverrides } = parseTournamentsTxt(input)
    expect(levelOverrides.get('A2812D92-B33F-4F37-AC72-3310BB1BE0F1')).toBe(1)
    expect(levelOverrides.get('66F4AF24-4FC2-4D05-9ACB-986F157A1978')).toBe(1)
    expect(levelOverrides.get('D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC')).toBe(2)
    // Trailing inline comment after the level is allowed.
    expect(levelOverrides.get('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(1)
    // Non-GUID and out-of-range (1-6) levels are ignored.
    expect(levelOverrides.has('NOT-A-GUID')).toBe(false)
    expect(levelOverrides.get('11111111-2222-3333-4444-555555555555')).toBeUndefined()
  })

  it('emits @bwf entries with provider=bwf when sidecar has entry', () => {
    const { manualEntries } = parseTournamentsTxt(MIXED_INPUT, {
      lookupByUrl: (url) => {
        if (url.includes('5726')) return {
          tmtId: 5726, tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
          slug: 'x', name: 'MITH 2026', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
        }
        if (url.includes('5670')) return {
          tmtId: 5670, tournamentCode: 'BBBB2222-2222-3333-4444-555555555555',
          slug: 'y', name: 'BAOJI 2026', startDateIso: '2026-04-01', endDateIso: '2026-04-06', resolvedAt: 'x',
        }
        return null
      },
    })
    const bwf = manualEntries.filter((e) => e.provider === 'bwf')
    expect(bwf).toEqual([
      { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'MITH 2026', provider: 'bwf', startDateIso: '2026-05-19' },
      { id: 'BBBB2222-2222-3333-4444-555555555555', name: 'BAOJI 2026', provider: 'bwf', startDateIso: '2026-04-01', done: true },
    ])
  })

  it('skips @bwf lines with no sidecar entry (fire-and-forget resolution)', () => {
    const resolved: string[] = []
    const { manualEntries } = parseTournamentsTxt(MIXED_INPUT, {
      lookupByUrl: () => null,
      onUnresolved: (url) => { resolved.push(url) },
    })
    expect(manualEntries.filter((e) => e.provider === 'bwf')).toEqual([])
    expect(resolved).toHaveLength(2)
  })

  it('parses # deny-name <substring> into lowercased patterns', () => {
    const input = `
# deny-name กีฬาบุคคล
#  deny-name   National Senior
# deny-name MiXeD CaSe
`.trim()
    const { denyNamePatterns } = parseTournamentsTxt(input)
    expect(denyNamePatterns).toEqual([
      'กีฬาบุคคล',
      'national senior',
      'mixed case',
    ])
  })

  it('ignores deny-name lines with empty patterns', () => {
    const { denyNamePatterns } = parseTournamentsTxt('# deny-name   ')
    expect(denyNamePatterns).toEqual([])
  })
})
