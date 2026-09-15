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
