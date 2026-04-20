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
  nowPlaying: boolean
}

export interface MatchTimeGroup {
  time: string
  matches: MatchEntry[]
}

export interface MatchDay {
  date: string
  label: string
  dateIso: string
  hasMatches?: boolean
}

export interface MatchesData {
  days: MatchDay[]
  currentDate: string
  timeGroups: MatchTimeGroup[]
}
