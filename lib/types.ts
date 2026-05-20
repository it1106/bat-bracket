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
  eventName?: string
  groupLetter?: string
  isPlayoff?: boolean
}

export type ProviderTag = 'bat' | 'bwf'

export interface TournamentRef {
  id: string
  provider: ProviderTag
}

export interface TournamentInfo {
  id: string
  name: string
  done?: boolean
  startDateIso?: string
  provider?: ProviderTag
}

export interface BracketData {
  html: string
  format: 'single-elimination' | 'double-elimination' | 'unknown'
}

export interface ApiError {
  error: string
}

export interface MatchPlayer {
  name: string
  playerId: string
  // ISO-style country code (e.g. "THA", "IDN") from BWF team payloads. Absent
  // for BAT, where players are organized by club via playerClubCache instead.
  country?: string
  // BWF-supplied flag image URL. Absent for BAT.
  countryFlagUrl?: string
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
  duration?: string
  walkover: boolean
  retired: boolean
  nowPlaying: boolean
  scheduledTime?: string
  scheduledDateLabel?: string
  sequenceLabel?: string
  h2hUrl?: string
  eventId?: string
  eventName?: string
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

export interface TournamentStatsCoverage {
  daysOnDisk: number
  daysFromMemory: number
  daysFromBat: number
  totalDays: number
}

export interface StatsMatchRef {
  draw: string
  round: string
  team1: string[]
  team2: string[]
  winnerSide: 1 | 2
  scores: MatchScore[]
  durationMinutes?: number
}

export interface StatsSetRef extends StatsMatchRef {
  setIndex: number
}

export interface StatsKpis {
  events: number
  matches: number
  decided: number
  walkovers: number
  retired: number
  nowPlaying: number
  players: number
  multiEventPlayers: number
  courtMinutes: number
  avgMatchMinutes: number
  threeSetterRate: number
}

export interface StatsDailyRow {
  date: string
  label: string
  total: number
  decided: number
  minutes: number
}

export interface StatsEventRow {
  name: string
  matches: number
  threeSetters: number
  walkovers: number
  decided: number
  avgMinutes: number
  winner: string[]
  winnerSeed?: string
}

export interface StatsCourtTimePlayer {
  playerId: string
  name: string
  seed?: string
  minutes: number
  matches: number
  events: string[]
}

export interface StatsDrama {
  marathon: StatsMatchRef | null
  highestSet: StatsSetRef | null
  highestScoringMatch: StatsMatchRef | null
  comebackCount: number
  comebackHighlight: StatsMatchRef | null
  mostCourtTime: StatsCourtTimePlayer | null
}

export interface StatsTopPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  wins: number
  losses: number
}

export interface StatsCourt {
  name: string
  matches: number
  minutes: number
}

export interface StatsClubMedalist {
  playerId: string
  name: string
  event: string
}

export interface StatsClubMedal {
  club: string
  gold: number
  silver: number
  bronze: number
  goldMedalists: StatsClubMedalist[]
  silverMedalists: StatsClubMedalist[]
  bronzeMedalists: StatsClubMedalist[]
}

export interface StatsMultiGoldPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  events: string[]
}

export interface StatsClubRoster {
  club: string
  players: number
  members: string[]
}

export interface StatsCountryRoster {
  country: string
  players: number
  members: string[]
}

export interface StatsIntegrityWalkover {
  event: string
  walkovers: number
  rate: number
}

export interface StatsIntegrityThreeSetter {
  event: string
  rate: number
  sample: number
}

export interface StatsIntegrity {
  walkoverByEvent: StatsIntegrityWalkover[]
  threeSetterByEvent: StatsIntegrityThreeSetter[]
}

export interface ComputedStats {
  kpis: StatsKpis
  dailyVolume: StatsDailyRow[]
  events: StatsEventRow[]
  drama: StatsDrama
  topPlayers: StatsTopPlayer[]
  courtUtilization: StatsCourt[]
  clubMedals: StatsClubMedal[]
  multiGoldPlayers: StatsMultiGoldPlayer[]
  clubRosters: StatsClubRoster[]
  countryRosters: StatsCountryRoster[]
  integrity: StatsIntegrity
}

export interface TournamentStats extends ComputedStats {
  tournamentId: string
  generatedAt: string
  coverage: TournamentStatsCoverage
}

export interface StandingsRow {
  position: number
  players: MatchPlayer[]
  club?: string
  played: number
  won: number
  drawn: number
  lost: number
  matches: string
  games: string
  points: string
  pts: number
}

export interface GroupData {
  drawNum: string
  groupLetter: string
  standings: StandingsRow[]
  matches: MatchEntry[]
}

export interface EventBundle {
  eventName: string
  playoff: BracketData
  playoffDrawNum: string
  groups: GroupData[]
}
