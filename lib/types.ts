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
  /** BAT tournament level (1-6) parsed from the regulations page, when known. */
  level?: number
  /**
   * Link to this tournament's page on the official provider site
   * (bat.tournamentsoftware.com for BAT, bwfbadminton.com for BWF). Absent for
   * BWF tournaments not yet resolved in the sidecar, so the UI must null-check.
   */
  officialUrl?: string
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
  // Potential opponents from the bracket's prior round when one side of the
  // match has no players yet (waiting on a previous-round match to resolve).
  // Length 1 means the other prior-round side was a bye or itself TBD.
  tbdOpponents?: MatchPlayer[][]
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
  draws: number
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
  size?: number
  type?: 'KO' | 'RR+PO'
  entries?: number
  topSeed?: StatsSeedHead
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

export interface StatsPlayerResult {
  event: string        // match.draw, e.g. "MD", "BS U15"
  round: string        // raw round string; rendered via abbrevRoundL at display time
  won: boolean
  opponent: string[]   // opposing team player names, seed-stripped
  scores: MatchScore[] // PLAYER-perspective: t1 is always the player's side
  retired?: boolean    // retired matches still count in W-L; flagged for a "(ret.)" marker
}

export interface StatsTopPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  wins: number
  losses: number
  results?: StatsPlayerResult[]
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

// Live tournament result of one player in one event, used to color roster chips.
export type ChipStatus = 'gold' | 'silver' | 'bronze' | 'out' | 'in'

// One player in a club's roster, with the event(s) they're entered in.
export interface StatsClubMember {
  name: string
  events: string[]
  playerId?: string
  // Per-event live result (champion/runner-up/semifinal/eliminated/still-in),
  // keyed by the same collapsed event string used in `events`. Optional so
  // stats blobs cached before this field existed still parse (missing ⇒ 'in').
  statusByEvent?: Record<string, ChipStatus>
  // Player's decided matches (all events), newest-first, player-perspective
  // scores. Optional so blobs cached before this field existed still parse.
  results?: StatsPlayerResult[]
}

export interface StatsClubRoster {
  club: string
  players: number
  members: string[]
  // Per-player breakdown (name + events) powering the club modal. Optional so
  // stats blobs cached before this field existed still parse; the UI falls back
  // to `members` (names only) until the blob regenerates.
  roster?: StatsClubMember[]
}

// One player in a country's roster, with the event(s) they're entered in.
export interface StatsCountryMember {
  name: string
  events: string[]
  // BWF playerId, used to look up date-of-birth/age for the country modal.
  playerId?: string
  // Per-event live result (champion/runner-up/semifinal/eliminated/still-in),
  // keyed by the same collapsed event string used in `events`. Optional so
  // stats blobs cached before this field existed still parse (missing ⇒ 'in').
  statusByEvent?: Record<string, ChipStatus>
  // Player's decided matches (all events), newest-first, player-perspective
  // scores. Optional so blobs cached before this field existed still parse.
  results?: StatsPlayerResult[]
}

export interface StatsCountryRoster {
  country: string
  players: number
  members: string[]
  // Per-player breakdown (name + events) powering the country modal. Optional
  // so stats blobs cached before this field existed still parse; the UI falls
  // back to `members` (names only) until the blob regenerates.
  roster?: StatsCountryMember[]
}

export interface StatsCountryMatrixCell {
  w: number
  l: number
}

// A single head-to-head grid: countries axis + the cell records. Shared by the
// all-ages matrix and each per-age-group sub-matrix.
export interface CountryMatrixData {
  // Axis order for both rows and columns (participating country codes).
  countries: string[]
  // cells[row][col] = the ROW country's record vs the COL country. Symmetric:
  // cells[A][B] = { w, l } ⇔ cells[B][A] = { w: l, l: w }. Diagonal (A vs A)
  // and pairings that never met are absent.
  cells: Record<string, Record<string, StatsCountryMatrixCell>>
}

export type CountryMatrixGender = 'male' | 'female' | 'mixed'
export type CountryMatrixDiscipline = 'singles' | 'doubles'

// One leaf sub-matrix for a single (age band, gender, discipline) combination.
// Age band is parsed from the draw ("U19", "U17", …; "" when the draw has no
// band); gender from the draw's leading letter (B/M=male, G/W=female, X=mixed);
// discipline from the second letter (S=singles, D=doubles). The UI merges the
// buckets matching the selected age, gender, and discipline filters.
export interface StatsCountryMatrixBucket extends CountryMatrixData {
  ageGroup: string
  gender: CountryMatrixGender
  discipline: CountryMatrixDiscipline
}

export interface StatsCountryMatrix extends CountryMatrixData {
  // Per-(age, gender, discipline) leaf buckets so the UI can filter by age
  // group, gender, and singles/doubles independently. Ordered age desc, then
  // male/female/mixed, then singles/doubles. Optional: present only when ≥2
  // leaves exist (a real filter choice), so a single-leaf tournament — or a
  // blob cached before this field existed — just shows the all/all grid with
  // no dropdowns.
  buckets?: StatsCountryMatrixBucket[]
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

export interface StatsSeedHead {
  players: string[]
  club?: string
}

export interface StatsDefendingChampion {
  event: string
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}

export interface StatsScheduledMatch {
  time: string
  event: string
  round: string
  team1: string[]
  team2: string[]
  sequenceLabel?: string
}

export interface StatsScheduleCourtBucket {
  court: string
  matches: StatsScheduledMatch[]
}

export interface StatsSchedulePreview {
  firstDayLabel: string
  matchCount: number
  courts: number
  opensAt?: string
  openingDayByCourt: StatsScheduleCourtBucket[]
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
  // BWF-only: country-vs-country head-to-head grid. Absent for club-based
  // tournaments (no country codes) or when fewer than two countries met.
  countryMatrix?: StatsCountryMatrix
  defendingChampion?: StatsDefendingChampion[]
  schedulePreview?: StatsSchedulePreview
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

/** A per-tournament-per-event match summary used by the Tournament History
 *  tooltip on the player profile. Trimmed from PlayerMatchRef to keep the
 *  SSR payload tight: tournamentId/eventId live in the lookup key, and the
 *  tooltip displays neither slugs nor schedule date. */
export interface PlayerTournamentMatch {
  round: string
  partners: string[]
  opponents: string[]
  scores: MatchScore[]
  outcome: 'W' | 'L' | 'WO-W' | 'WO-L' | 'RET-W' | 'RET-L'
}

export type Discipline = 'singles' | 'doubles' | 'mixed'

export type OpponentTimeWindow = '30d' | '90d' | '180d' | '1y' | 'all'

export interface PlayerEventResult {
  tournamentId: string
  eventId: string
  eventName: string
  discipline: Discipline
  bestFinish: 'Champion' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'R256' | 'RR'
  wins: number
  losses: number
  /** Opening-round size of the event's bracket (largest round present:
   *  R64→64, R32→32, …, Final→2). Drives the bye-aware first-round-loss
   *  points row. Optional so previously-cached indexes still load. */
  drawSize?: number
  /** True when the player won no matches and their eliminating loss was a
   *  walkover (no-show, WO-L). Such a first-round walkover-loss earns no
   *  ranking points. Optional; absent on older indexes. */
  lostByWalkover?: boolean
  /** True when the player won their deepest recorded match and advanced — the
   *  next match isn't played yet (e.g. won the SF, final pending). They are
   *  still alive in the draw, so their points floor is the next round up and
   *  the UI shows them as active rather than eliminated. Optional. */
  active?: boolean
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
  avgCourtTime?: number
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
  /** Keyed `${tournamentId}:${eventId}` → matches in that event of that
   *  tournament, sorted deepest round first (Final → SF → … → RR). Pulled
   *  inline by the Tournament History chip tooltip. Optional so a fresh
   *  install that hasn't yet rebuilt the index still loads. */
  tournamentMatches?: Record<string, PlayerTournamentMatch[]>
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
    /** Count of matches whose `durationMinutes > 0` — i.e. the matches that
     *  contributed to `courtMinutes`. Used to show "(N)" behind the displayed
     *  court time on the leaderboard. Optional so previously-built indexes
     *  still load; display falls back to 0 when absent. */
    matchesWithDuration?: number
  }
  opponents: OpponentRecord[]
  /** Top-12 opponents bucketed by time window. The `all` bucket is identical
   *  to `opponents` (kept for backward-compat); windowed buckets contain
   *  only meetings whose `scheduledDateIso` falls inside the window,
   *  measured backward from the latest match in the dataset. Optional so a
   *  previously-built index still loads — readers fall back to `opponents`
   *  for the `all` tab and render an empty list for windowed tabs. */
  opponentsByWindow?: Record<OpponentTimeWindow, OpponentRecord[]>
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
  /** Country-flag image URL (protocol-relative). Today populated only for
   *  BWF ranking entries; the renderer shows nothing when absent. */
  flagUrl?: string
  /** Mirrors RankingEntry.previousRank. Populated only on ranking-category
   *  entries; other categories ignore it. */
  previousRank?: number
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

export interface RankingEntry {
  rank: number
  name: string
  slug: string
  club: string
  points: number
  tournaments: number
  /** Numeric `player=<id>` URL param scraped directly from the row link.
   *  Populated by the BWF scraper (always non-empty). BAT scraper leaves
   *  this empty and falls back to its 3-hop discovery path at detail-fetch
   *  time. */
  globalPlayerId?: string
  /** Flag image URL from the BWF page's `<img class="intext flag">`,
   *  e.g. `//static.tournamentsoftware.com/content/images/flags/THA.svg`.
   *  Always protocol-relative; consumers should prepend `https:` if needed.
   *  Optional and BWF-only in practice. */
  countryFlagUrl?: string
  /** This player's rank in the immediately previous weekly publication for
   *  the same event/provider. Absent when the player wasn't in the prior
   *  snapshot (genuinely new entrant, or first-ever scrape). */
  previousRank?: number
}

export interface RankingEvent {
  eventCode: string
  eventName: string
  entries: RankingEntry[]
}

export interface Ranking {
  /** Which provider this snapshot is for. Added at v12; legacy v11 files
   *  (without `provider`) are rejected on read and repopulated by the boot
   *  kick. */
  provider: ProviderTag
  scrapedAt: string
  publishDate: string
  /** The weekly id= URL parameter on category/player pages. Stable for the
   *  duration of one publication; changes every Tuesday (BAT) or Wednesday
   *  (BWF). */
  rankingId: string
  events: RankingEvent[]
}

// Backward-compat aliases so callers can be migrated in a follow-up task
// without a giant churn here. Remove once every site is renamed.
export type BatRankingEntry = RankingEntry
export type BatRankingEvent = RankingEvent
export type BatRanking      = Ranking

export interface RankingPlayerRank {
  eventName: string
  rank: number
  points: number
  tournaments: number
}

/** One target ranking event a tournament row contributes to, with the
 *  credit value parsed from the Used-for marker. Credit equals the row's
 *  raw `points` when the marker had no parenthesised value (same-tier),
 *  or the parenthesised value when present (cross-tier, e.g. 30% of raw
 *  for one tier up in BWF). */
export interface RankingTargetCredit {
  eventName: string
  credit: number
}

/** One tournament row on a player's ranking detail page (BAT or BWF). */
export interface RankingPlayerTournament {
  tournamentName: string
  /** Tournament GUID parsed from the row link; null if the href didn't
   *  carry one (defensive — surface the row but no click-through). */
  tournamentId: string | null
  /** Source event as shown by the upstream (e.g., "BS U15", "MD U17", "XD U23"). */
  sourceEvent: string
  /** "YYYY-WW" week of the tournament. */
  week: string
  /** Placement string as shown (e.g., "5/8", "17/32"). */
  result: string
  /** Tournament points earned. */
  points: number
  /** Raw strings parsed from the Used-for marker, e.g.
   *  `["Boy's singles U17(288)", "Boy's singles U15"]`. Kept so BAT
   *  callers (which only check `length > 0`) keep working. */
  countsTowardRankings: string[]
  /** Structured per-target credits parsed from the same marker. Optional
   *  so detail JSONs cached before this change still load. */
  countsTowardRankingsParsed?: RankingTargetCredit[]
}

export interface RankingPlayerDetail {
  /** Stable global player id (the "player=" URL param) — numeric per
   *  TournamentSoftware, shared across BAT and BWF rankings. */
  globalPlayerId: string
  /** publishDate the detail was scraped against. Read-time mismatch with
   *  the current Ranking.publishDate invalidates. */
  publishDate: string
  scrapedAt: string
  tournaments: RankingPlayerTournament[]
}

export interface RankingPlayerDetailCache {
  version: 1
  /** Success path. */
  detail?: RankingPlayerDetail
  /** Negative cache for a player whose detail page 404'd. Keyed to the same
   *  publishDate as a success would be, so it expires with the next
   *  weekly publication. */
  notFound?: { publishDate: string; scrapedAt: string }
}

// Backward-compat aliases for one cycle.
export type BatRankingPlayerRank        = RankingPlayerRank
export type BatRankingPlayerTournament  = RankingPlayerTournament
export type BatRankingPlayerDetail      = RankingPlayerDetail
export type BatRankingPlayerDetailCache = RankingPlayerDetailCache

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
