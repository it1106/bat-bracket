import { isAwaitingBracketPublication } from '@/lib/bracket-state'
import { translate } from '@/lib/i18n'

const base = { selectedTournament: 'T1', loadingDraws: false, error: null, drawCount: 0 }

describe('isAwaitingBracketPublication', () => {
  it('is true for a tournament that is listed but has no draws yet', () => {
    expect(isAwaitingBracketPublication(base)).toBe(true)
  })

  it('is false while the draws are still loading', () => {
    // An empty list means nothing until the fetch lands — claiming "not
    // published" here would flash on every tournament switch.
    expect(isAwaitingBracketPublication({ ...base, loadingDraws: true })).toBe(false)
  })

  it('is false when the draw fetch failed', () => {
    // A network failure is not evidence that nothing is published, and the
    // error banner already says what went wrong.
    expect(isAwaitingBracketPublication({ ...base, error: 'Failed to load draws' })).toBe(false)
  })

  it('is false before a tournament is chosen', () => {
    expect(isAwaitingBracketPublication({ ...base, selectedTournament: '' })).toBe(false)
  })

  it('is false once draws exist', () => {
    expect(isAwaitingBracketPublication({ ...base, drawCount: 33 })).toBe(false)
  })
})

describe('the message it drives', () => {
  it.each(['en', 'th'] as const)('is translated in %s', (lang) => {
    expect(translate('noBracketPublished', lang).trim().length).toBeGreaterThan(0)
    // Distinct from the "pick one" prompt it replaces — that is the whole point.
    expect(translate('noBracketPublished', lang)).not.toBe(translate('selectDrawPrompt', lang))
  })
})
