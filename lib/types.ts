export interface Tournament {
  id: string
  name: string
  date: string
  url: string
}

export interface TournamentEvent {
  id: string
  name: string
  drawUrl: string
}

export interface DrawInfo {
  drawNum: string
  name: string
  size: string
  type: string
}

export interface TournamentInfo {
  id: string
  name: string
  done?: boolean
}

export interface BracketData {
  html: string
  format: 'single-elimination' | 'groups-knockout' | 'double-elimination' | 'unknown'
}

export interface ApiError {
  error: string
}

export interface MatchPlayer {
  name: string
  playerId: string
}

export interface MatchScore {
  t1: number
  t2: number
}

export interface MatchEntry {
  draw: string
  drawNum: string
  round: string
  team1: MatchPlayer[]
  team2: MatchPlayer[]
  winner: 1 | 2 | null
  scores: MatchScore[]
  court: string
  walkover: boolean
  retired: boolean
  nowPlaying: boolean
  scheduledTime?: string
  sequenceLabel?: string
  h2hUrl?: string
  eventId?: string
  // Comma-separated, sorted player IDs of the bracket sibling match (the
  // match whose winner this match's winner would face if they advance).
  siblingPlayerIds?: string
}

export interface H2HRecord {
  category: string
  winsP1: number
  winsP2: number
}

export interface H2HMatch {
  tournament: string
  event: string
  round: string
  date: string
  team1: string[]
  team2: string[]
  winner: 1 | 2 | null
  scores: MatchScore[]
  walkover: boolean
  retired: boolean
}

export interface H2HData {
  player1: string
  player2: string
  records: H2HRecord[]
  matches: H2HMatch[]
}

export interface MatchTimeGroup {
  time: string
  matches: MatchEntry[]
}

export interface MatchCourtGroup {
  court: string
  matches: MatchEntry[]
}

export type MatchScheduleGroup =
  | ({ type: 'time' } & MatchTimeGroup)
  | ({ type: 'court' } & MatchCourtGroup)

export interface MatchDay {
  date: string
  label: string
  dateIso: string
  hasMatches?: boolean
  cached?: boolean
}

export interface MatchesData {
  days: MatchDay[]
  currentDate: string
  groups: MatchScheduleGroup[]
}

export interface PlayerEvent {
  eventId: string
  name: string
}

export interface WLRecord {
  wins: number
  losses: number
}

export interface CategoryStats {
  career: WLRecord
  ytd: WLRecord
}

export interface PlayerStats {
  total: CategoryStats
  singles: CategoryStats
  doubles: CategoryStats
  mixed: CategoryStats
}

export interface PlayerProfile {
  playerId: string
  name: string
  club: string
  yob: string
  events: PlayerEvent[]
  matches: MatchEntry[]
  stats?: PlayerStats
}
