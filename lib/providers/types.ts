import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  ProviderTag, TournamentRef, EventBundle, StandingsRow,
} from '@/lib/types'

export interface GroupRefresh {
  standings: StandingsRow[]
  matches: MatchEntry[]
}

export interface TournamentProvider {
  tag: ProviderTag
  getMeta(ref: TournamentRef): Promise<TournamentInfo | null>
  getDraws(ref: TournamentRef): Promise<DrawInfo[]>
  getBracket(ref: TournamentRef, drawNum: string, fromRound?: number): Promise<BracketData | null>
  // Structured match entries for a single draw, including unplayed roster
  // slots. Used by /api/stats to build the full event/player roster even when
  // no per-day matches have been published yet for the draw.
  getDrawMatches(ref: TournamentRef, drawNum: string, drawName: string): Promise<MatchEntry[]>
  getMatchesFull(ref: TournamentRef): Promise<MatchesData | null>
  getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]>
  getPlayer(ref: TournamentRef, playerId: string): Promise<PlayerProfile | null>
  getH2H(ref: TournamentRef, p1: string, p2: string): Promise<H2HData | null>
  getLiveScore(ref: TournamentRef, matchId: string): Promise<MatchEntry | null>
  getEventBundle(ref: TournamentRef, eventName: string): Promise<EventBundle | null>
  refreshGroup(ref: TournamentRef, drawNum: string): Promise<GroupRefresh | null>
}

export class NotImplementedError extends Error {
  constructor(method: string, provider: ProviderTag) {
    super(`${provider} provider has not implemented ${method} yet`)
  }
}
