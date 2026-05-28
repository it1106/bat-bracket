import { fullCachePath, cachePath } from '@/lib/day-cache'

// Cache filenames must be case-insensitive in the tournament id, because the
// same UUID arrives in mixed cases from different sources (URL params from
// users, registry, discovery-store uppercase). Without normalization, both
// `.cache/full/ABC.json` AND `.cache/full/abc.json` can exist as duplicates
// for the same tournament — seen in production where 4526A530 and 4526a530
// were independently pinned. They must resolve to the same on-disk path.
describe('day-cache path keys are case-insensitive', () => {
  it('fullCachePath collapses tournament-id casing', () => {
    expect(fullCachePath('4526A530-2091-4932-ADAB-B0A9B1FFF98E'))
      .toBe(fullCachePath('4526a530-2091-4932-adab-b0a9b1fff98e'))
  })

  it('cachePath collapses tournament-id casing for day caches too', () => {
    expect(cachePath('ABC123', '2026-05-29'))
      .toBe(cachePath('abc123', '2026-05-29'))
  })
})
