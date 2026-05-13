import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  ProviderTag, TournamentRef,
} from '@/lib/types'

export interface TournamentProvider {
  tag: ProviderTag
  getMeta(ref: TournamentRef): Promise<TournamentInfo | null>
  getDraws(ref: TournamentRef): Promise<DrawInfo[]>
  getBracket(ref: TournamentRef, drawNum: string, fromRound?: number): Promise<BracketData | null>
  getMatchesFull(ref: TournamentRef): Promise<MatchesData | null>
  getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]>
  getPlayer(ref: TournamentRef, playerId: string): Promise<PlayerProfile | null>
  getH2H(ref: TournamentRef, p1: string, p2: string): Promise<H2HData | null>
  getLiveScore(ref: TournamentRef, matchId: string): Promise<MatchEntry | null>
}

export class NotImplementedError extends Error {
  constructor(method: string, provider: ProviderTag) {
    super(`${provider} provider has not implemented ${method} yet`)
  }
}
