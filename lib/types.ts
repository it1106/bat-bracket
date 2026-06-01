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

export type ProviderTag = 'bat' | 'bwf' | 'combined'

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
  // Calendar date (YYYY-MM-DD) of the match, stamped from the owning day cache
  // during player-index aggregation. Not populated on the live schedule path.
  dateIso?: string
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
  players: number
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

export interface SeedEntry {
  seed: number
  players: string[]
}

export interface SeedEvent {
  eventName: string
  seeds: SeedEntry[]
}

export interface TournamentOverview {
  notes: string[]
  seedEvents: SeedEvent[]
}

// ─── Deep player stats ─────────────────────────────────────

export interface PlayerKey {
  provider: ProviderTag
  slug: string
}

export interface PlayerMatchRef {
  tournamentId: string
  tournamentName: string
  tournamentDateIso: string
  eventId: string
  eventName: string
  drawNum: string
  round: string
  partners: string[]
  opponents: string[]
  opponentSlugs: string[]
  partnerSlugs: string[]
  scores: MatchScore[]
  outcome: 'W' | 'L' | 'WO-W' | 'WO-L' | 'RET-W' | 'RET-L'
  durationMinutes?: number
  scheduledDateIso?: string
}

export type Discipline = 'singles' | 'doubles' | 'mixed'

export interface PlayerEventResult {
  tournamentId: string
  eventId: string
  eventName: string
  discipline: Discipline
  bestFinish: 'Champion' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'RR'
  wins: number
  losses: number
}

export interface DisciplineSummary {
  wins: number
  losses: number
  titles: number
  finals: number
  semis: number
}

export interface OpponentRecord {
  slug: string
  name: string
  meetings: number
  wins: number
  losses: number
  lastRound: string
  lastEvent: string
}

export interface PartnerRecord {
  slug: string
  name: string
  matchesTogether: number
  wins: number
  losses: number
  primaryEvent: string
}

export interface PlayerRanks {
  titles?: number
  wins?: number
  winPct?: number
  courtTime?: number
  threeSetterWins?: number
  comebackWins?: number
  matchesLast90?: number
  tournamentsEntered?: number
  bestSingles?: number
  bestDoubles?: number
  bestMixed?: number
  deciderRecord?: number
  threeGamerRate?: number
}

export interface PlayerRecord {
  key: PlayerKey
  displayName: string
  altNames: string[]
  clubs: string[]
  country?: string
  // A (tournamentId, playerId) pair from the player's most recent match, used to
  // reach their BAT global profile for live stats/YOB. BAT only; absent for BWF.
  sampleRef?: { tournamentId: string; playerId: string }
  totals: {
    matches: number
    wins: number
    losses: number
    walkoversReceived: number
    walkoversGiven: number
    retirementsReceived: number
    retirementsGiven: number
  }
  byDiscipline: {
    singles: DisciplineSummary
    doubles: DisciplineSummary
    mixed: DisciplineSummary
  }
  titles: PlayerEventResult[]
  finals: PlayerEventResult[]
  semis: PlayerEventResult[]
  tournaments: Array<{
    tournamentId: string
    tournamentName: string
    tournamentDateIso: string
    events: PlayerEventResult[]
  }>
  recentForm: PlayerMatchRef[]
  matchCharacter: {
    courtMinutes: number
    avgMatchMinutes: number
    longestMatchMinutes: number
    longestMatchRef: PlayerMatchRef | null
    threeSetterCount: number
    threeSetterRate: number
    threeSetterWins: number
    comebackWins: number
    firstGameLost: number
    comebackWinRef: PlayerMatchRef | null
    matchesLast90: number
  }
  opponents: OpponentRecord[]
  partners: PartnerRecord[]
  ranks: PlayerRanks
}

export interface PlayerIndex {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string
  sources: Array<{ tournamentId: string; tournamentName: string; tournamentDateIso: string }>
  totalPlayers: number
  totalMatches: number
  players: Record<string, PlayerRecord>
}

export interface LeaderboardEntry {
  rank: number
  slug: string
  name: string
  primaryClub: string
  value: number
  display: string
  qualifier?: string
  provider?: ProviderTag   // per-entry override for profile link; used by combined leaderboard
  extra?: string           // optional secondary stat shown between name and value
}

export type LeaderboardCategory = 'headline' | 'discipline' | 'character' | 'activity' | 'ranking'

export interface LeaderboardBoard {
  id: string
  titleKey: string
  icon: string
  category: LeaderboardCategory
  qualifier?: string
  entries: LeaderboardEntry[]
}

export interface Leaderboards {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string
  boards: LeaderboardBoard[]
}

export interface BatRankingEntry {
  rank: number
  name: string
  slug: string
  club: string
  points: number
  tournaments: number
}

export interface BatRankingEvent {
  eventCode: string
  eventName: string
  entries: BatRankingEntry[]
}

export interface BatRanking {
  scrapedAt: string
  publishDate: string
  /** The weekly id= URL parameter on category/player pages. Stable for the
   *  duration of one publication; changes every Tuesday. */
  rankingId: string
  events: BatRankingEvent[]
}

export interface BatRankingPlayerRank {
  eventName: string
  rank: number
  points: number
  tournaments: number
}

/** One tournament row on a player's BAT ranking detail page. */
export interface BatRankingPlayerTournament {
  tournamentName: string
  /** Tournament GUID parsed from the row link; null if the href didn't
   *  carry one (defensive — surface the row but no click-through). */
  tournamentId: string | null
  /** Source event as shown on BAT (e.g., "BS U15", "MD U17", "XD U23"). */
  sourceEvent: string
  /** "YYYY-WW" week of the tournament. */
  week: string
  /** Placement string as shown (e.g., "5/8", "17/32"). */
  result: string
  /** Tournament points earned. */
  points: number
  /** Ranking categories this row counts toward, parsed from the marker
   *  img's title attribute. Empty when the row is not in any top-10. */
  countsTowardRankings: string[]
}

export interface BatRankingPlayerDetail {
  /** Stable global BAT player id (the "player=" URL param). */
  globalPlayerId: string
  /** publishDate the detail was scraped against. Read-time mismatch with
   *  the current BatRanking.publishDate invalidates. */
  publishDate: string
  scrapedAt: string
  tournaments: BatRankingPlayerTournament[]
}

export interface BatRankingPlayerDetailCache {
  version: 1
  /** Success path. */
  detail?: BatRankingPlayerDetail
  /** Negative cache for a player whose BAT page 404'd. Keyed to the same
   *  publishDate as a success would be, so it expires with the next
   *  weekly publication. */
  notFound?: { publishDate: string; scrapedAt: string }
}

/** Single-file map of slug → BAT global player id. Append-only on success;
 *  failures are persisted as { globalPlayerId: null, reason } so the
 *  discovery route doesn't re-hit every page view. */
export interface BatPlayerIdMap {
  version: 1
  players: Record<string, { globalPlayerId: string | null; reason?: string }>
}

// Live-scraped extras from a player's BAT global profile (career/YTD stats + YOB).
export interface PlayerProfileExtra {
  scrapedAt: string
  yob: string
  stats: PlayerStats
}

export interface PlayerProfileExtraCache {
  version: 1
  players: Record<string, PlayerProfileExtra>
}

export interface PlayerIndexTournamentInput {
  tournamentId: string
  tournamentName: string
  tournamentDateIso: string
  data: MatchesData
  clubs: Record<string, string>
}

export interface IdentityMatch {
  batSlug: string
  bwfSlug: string
  confidence: number       // 0–1
  method: 'fuzzy'
  override?: boolean       // manually confirmed — not re-inferred on next build
  rejected?: boolean       // manually marked false positive — always skipped
}

export interface PlayerIdentityMap {
  generatedAt: string
  matches: IdentityMatch[]
}

export interface PlayerLink {
  batName: string   // Thai display name as it appears in the BAT player index
  bwfSlug: string   // BWF player slug
}
