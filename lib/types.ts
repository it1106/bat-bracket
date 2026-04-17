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
}

export interface BracketData {
  html: string
  format: 'single-elimination' | 'groups-knockout' | 'double-elimination' | 'unknown'
}

export interface ApiError {
  error: string
}
