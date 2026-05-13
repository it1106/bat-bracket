import type { TournamentProvider } from './types'

export const bwfProvider: TournamentProvider = {
  tag: 'bwf',
  async getMeta() { return null },
  async getDraws() { return [] },
  async getBracket() { return null },
  async getMatchesFull() { return null },
  async getDayMatches() { return [] },
  async getPlayer() { return null },
  async getH2H() { return null },
  async getLiveScore() { return null },
}
