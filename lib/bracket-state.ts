/** Has the SELECTED draw been published with entries in it?
 *
 *  Upstream publishes a draw's shape before its entries: the bracket parses
 *  into a complete grid of empty slots, which renders as a blank page. To a
 *  reader that is indistinguishable from no bracket at all, so it gets the
 *  same message. THE MALL 2026 showed 33 such draws of which only two (BS U15,
 *  BS U17) actually held entries — which is also why this is judged per draw
 *  and never per tournament: calling the whole tournament unpublished would
 *  have hidden the two real brackets.
 *
 *  Undefined `entrantCount` means "not counted" (a bracket object cached
 *  before the count existed), not "none" — those still render. */
export function isDrawWithoutEntries(s: {
  bracketHtml: string
  entrantCount?: number
}): boolean {
  return !!s.bracketHtml && s.entrantCount === 0
}

/** Are ALL of this tournament's draws published with nobody in them?
 *
 *  Upstream lists a draw as soon as its shape exists, so "there are draws"
 *  does not mean "there is a bracket". This answers the question the Bracket
 *  tab asks before any draw is picked, which is why it must be certain: a
 *  wrong `true` disables the dropdown and hides brackets that do exist.
 *
 *  So it is true only when EVERY draw is known to hold zero entrants. One
 *  draw with entries, or one whose count the server hasn't cached, makes it
 *  false — a tournament can publish some of its draws and not others, and an
 *  unknown count is not a zero. Where coverage is incomplete the reader simply
 *  gets the per-draw message instead, one selection later. */
export function areAllDrawsUnentered(draws: Array<{ entrantCount?: number }>): boolean {
  return draws.length > 0 && draws.every(d => d.entrantCount === 0)
}

/** Is this tournament simply without a published bracket yet?
 *
 *  Since discovery started admitting tournaments as soon as their seeded
 *  entries appear, a tournament is listed for days before its draws are made.
 *  An empty draw list is therefore a normal waiting state, not a failure — and
 *  it must not be reported as "Select a draw to view the bracket", which asks
 *  the reader to pick from an empty, disabled dropdown.
 *
 *  False while the draws are still in flight (an empty list has no meaning
 *  yet) and false when the fetch failed, which has its own error banner: a
 *  network failure is not evidence that nothing is published. */
export function isAwaitingBracketPublication(s: {
  selectedTournament: string
  loadingDraws: boolean
  error: string | null
  drawCount: number
}): boolean {
  return !!s.selectedTournament && !s.loadingDraws && !s.error && s.drawCount === 0
}
