export type Lang = 'en' | 'th'

const ROUND_TRANSLATIONS: Record<string, string> = {
  'finale': 'Final',
  'halve finale': 'Semi Final',
  'kwartfinale': 'Quarter Final',
  'eerste ronde': 'R1',
  'tweede ronde': 'R2',
  'derde ronde': 'R3',
  'vierde ronde': 'R4',
  'groepsfase': 'Groups',
}

function normalizeRound(name: string): { kind: 'final' | 'semi' | 'quarter' | 'roundOf' | 'round' | 'raw'; n?: number; raw: string } {
  const n = name.trim()
  const translated = ROUND_TRANSLATIONS[n.toLowerCase()] ?? n
  const t = translated.trim()
  if (/^final$/i.test(t)) return { kind: 'final', raw: t }
  if (/semi.?final/i.test(t)) return { kind: 'semi', raw: t }
  if (/quarter.?final/i.test(t)) return { kind: 'quarter', raw: t }
  const rofMatch = t.match(/round\s+of\s+(\d+)/i)
  if (rofMatch) return { kind: 'roundOf', n: parseInt(rofMatch[1], 10), raw: t }
  const rondVanMatch = t.match(/^ronde\s+van\s+(\d+)$/i)
  if (rondVanMatch) return { kind: 'roundOf', n: parseInt(rondVanMatch[1], 10), raw: t }
  const rMatch = t.match(/^(?:round|rd\.?|r)\s*(\d+)/i)
  if (rMatch) return { kind: 'round', n: parseInt(rMatch[1], 10), raw: t }
  const ordMatch = t.match(/^(\d+)(?:st|nd|rd|th)\s+round/i)
  if (ordMatch) return { kind: 'round', n: parseInt(ordMatch[1], 10), raw: t }
  return { kind: 'raw', raw: t }
}

export function longRoundL(name: string, lang: Lang = 'en'): string {
  const r = normalizeRound(name)
  if (lang === 'th') {
    if (r.kind === 'final') return 'รอบชิงชนะเลิศ'
    if (r.kind === 'semi') return 'รอบรองชนะเลิศ'
    if (r.kind === 'quarter') return 'รอบก่อนรองชนะเลิศ'
    if (r.kind === 'roundOf') return `รอบ ${r.n}`
    if (r.kind === 'round') return `รอบ ${r.n}`
    return r.raw
  }
  if (r.kind === 'final') return 'Final'
  if (r.kind === 'semi') return 'Semi Final'
  if (r.kind === 'quarter') return 'Quarter Final'
  if (r.kind === 'roundOf') return `Round of ${r.n}`
  if (r.kind === 'round') return `Round ${r.n}`
  return r.raw
}

export function abbrevRoundL(name: string, lang: Lang = 'en'): string {
  const r = normalizeRound(name)
  if (lang === 'th') {
    if (r.kind === 'final') return 'รอบชิง'
    if (r.kind === 'semi') return 'รอบรองฯ'
    if (r.kind === 'quarter') return 'รอบก่อนรองฯ'
    if (r.kind === 'roundOf') return `รอบ ${r.n}`
    if (r.kind === 'round') return `รอบ ${r.n}`
    return r.raw
  }
  if (r.kind === 'final') return 'F'
  if (r.kind === 'semi') return 'SF'
  if (r.kind === 'quarter') return 'QF'
  if (r.kind === 'roundOf') return `R${r.n}`
  if (r.kind === 'round') return `R${r.n}`
  return r.raw.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 4)
}

export type TKey =
  | 'appTitle1'
  | 'appTitle2'
  | 'appTitle3'
  | 'appSubtitle'
  | 'tournament'
  | 'draw'
  | 'trackLabel'
  | 'searchPlaceholder'
  | 'selectTournament'
  | 'pastEvents'
  | 'showPast'
  | 'hidePast'
  | 'selectDraw'
  | 'noDraws'
  | 'loading'
  | 'loadingBracket'
  | 'loadingMatches'
  | 'loadingPlayer'
  | 'loadingH2H'
  | 'exportJpg'
  | 'overview'
  | 'tournamentInformation'
  | 'seededEntries'
  | 'bracket'
  | 'matchSchedule'
  | 'winner'
  | 'notPlayed'
  | 'trackedPlayer'
  | 'viewingFrom'
  | 'showAllRounds'
  | 'startPrompt'
  | 'selectDrawPrompt'
  | 'noMatchesScheduled'
  | 'eventsEntered'
  | 'matchResults'
  | 'matchHistory'
  | 'yob'
  | 'bye'
  | 'walkover'
  | 'retired'
  | 'live'
  | 'nowPlaying'
  | 'noPlayerMatches'
  | 'noH2HData'
  | 'noH2HDiscipline'
  | 'filterAll'
  | 'filterSingles'
  | 'filterDoubles'
  | 'filterMixed'
  | 'vs'
  | 'vsMatch'
  | 'clearSearch'
  | 'highlight'
  | 'excludeCompleted'
  | 'darkMode'
  | 'lightMode'
  | 'close'
  | 'h2hButton'
  | 'langToggle'
  | 'statsCareer'
  | 'statsSingles'
  | 'statsDoubles'
  | 'statsMixed'
  | 'statsYearSuffix'
  | 'liveMatches'
  | 'jumpToNext'
  | 'scrollToTop'
  | 'playingOrderNext'
  | 'playingOrderAway'
  | 'winRate'
  | 'bracketRoundHint'
  | 'searchNotFound'
  | 'filterMatchCount'
  | 'searchHelp'
  | 'pleaseSelectTournament'
  | 'customTab'
  | 'customTabCreate'
  | 'customTabEdit'
  | 'customTabName'
  | 'customTabKeyword'
  | 'customTabKeywordPlaceholder'
  | 'customTabAddTooltip'
  | 'customTabSave'
  | 'customTabCancel'
  | 'customTabDelete'
  | 'customTabDeleteConfirm'
  | 'customTabEditTabs'
  | 'customTabEditDone'
  | 'tournamentStats'
  | 'statsKpiEvents'
  | 'statsKpiMatches'
  | 'statsKpiPlayers'
  | 'statsKpiMultiEvent'
  | 'statsKpiCourtTime'
  | 'statsKpiAvgMatch'
  | 'statsKpiThreeSetters'
  | 'statsKpiComebacks'
  | 'statsSectionByNumbers'
  | 'statsSectionMatchesPerDay'
  | 'statsSectionEvents'
  | 'statsSectionDrama'
  | 'statsSectionTopPlayers'
  | 'statsSectionCourtUtilization'
  | 'statsSectionClubMedals'
  | 'statsSectionClubRosters'
  | 'statsSectionCountryRosters'
  | 'statsShowAll'
  | 'statsShowLess'
  | 'statsColCountry'
  | 'statsColPlayers'
  | 'statsSectionMultiGold'
  | 'statsSectionIntegrity'
  | 'statsMarathonBadge'
  | 'statsHighestSetBadge'
  | 'statsHighestScoringBadge'
  | 'statsComebacksBadge'
  | 'statsMostCourtTimeBadge'
  | 'statsCol3Set'
  | 'statsColAvg'
  | 'statsColMatches'
  | 'statsColWinner'
  | 'statsColPlayer'
  | 'statsColClub'
  | 'statsColEvents'
  | 'statsColWL'
  | 'statsEmptyState'
  | 'statsLoadFailed'
  | 'alertsTitle'
  | 'alertsNewTournaments'
  | 'alertsNewSchedule'
  | 'alertsNewRanking'
  | 'alertsRankingTitle'
  | 'alertsBellAria'
  | 'rankingDetailTitle'
  | 'rankingDetailTabSingles'
  | 'rankingDetailTabDoubles'
  | 'rankingDetailTabMixed'
  | 'rankingDetailTopTen'
  | 'rankingDetailOthersTournaments'
  | 'rankingDetailExpiringSoon'
  | 'rankingDetailLoadFailed'
  | 'rankingDetailRetry'
  | 'rankingDetailEmpty'
  | 'viewFullProfile'
  | 'playerProfile'
  | 'byDiscipline'
  | 'singles' | 'doubles' | 'mixed'
  | 'tournamentHistory'
  | 'recentForm'
  | 'matchCharacter'
  | 'frequentOpponents'
  | 'frequentPartners'
  | 'courtTime'
  | 'avgMatch'
  | 'longestMatch'
  | 'threeSetterRate'
  | 'comebackWins'
  | 'walkoversReceived'
  | 'walkoversGiven'
  | 'champion'
  | 'leaderboards'
  | 'leaderboardsSub'
  | 'lbHeadline' | 'lbDiscipline' | 'lbCharacter' | 'lbActivity' | 'lbRanking'
  | 'lbRankingAsOf'
  | 'lbSearchPlaceholder' | 'lbSearchEmpty'
  | 'currentRanking'
  | 'lbMostTitles' | 'lbMostWins' | 'lbHighestWinPct' | 'lbMostCourtTime'
  | 'lbBestSingles' | 'lbBestDoubles' | 'lbBestMixed'
  | 'lbThreeSetterWins' | 'lbComebackWins' | 'lbDeciderRecord' | 'lb3Gamers'
  | 'lbMatchesLast90' | 'lbTournamentsEntered'
  | 'min20' | 'min10' | 'min5'
  | 'lbMostTitlesHelp' | 'lbMostWinsHelp' | 'lbHighestWinPctHelp' | 'lbMostCourtTimeHelp'
  | 'lbBestSinglesHelp' | 'lbBestDoublesHelp' | 'lbBestMixedHelp'
  | 'lbThreeSetterWinsHelp' | 'lbComebackWinsHelp' | 'lbDeciderRecordHelp' | 'lb3GamersHelp'
  | 'lbMatchesLast90Help' | 'lbTournamentsEnteredHelp'

const dict: Record<Lang, Record<TKey, string>> = {
  en: {
    appTitle1: 'BAT',
    appTitle2: 'Unofficial',
    appTitle3: 'Scoreboard',
    appSubtitle: 'Check BAT official website for accuracy',
    tournament: 'Tournament',
    draw: 'Draw',
    trackLabel: 'Search',
    searchPlaceholder: 'Player, club, or event',
    selectTournament: '— Select tournament —',
    pastEvents: 'Past Events',
    showPast: 'Show past',
    hidePast: 'Hide past',
    selectDraw: '— Select draw —',
    noDraws: 'No draws',
    loading: 'Loading…',
    loadingBracket: 'Loading bracket…',
    loadingMatches: 'Loading matches…',
    loadingPlayer: 'Loading player profile…',
    loadingH2H: 'Loading H2H data…',
    exportJpg: '↓ Export JPG',
    overview: 'Overview',
    tournamentInformation: 'Tournament Information',
    seededEntries: 'Seeded Entries',
    bracket: 'Bracket',
    matchSchedule: 'Match Schedule',
    winner: 'Winner',
    notPlayed: 'Not played',
    trackedPlayer: 'Tracked player',
    viewingFrom: 'Viewing from',
    showAllRounds: '↩ Show all rounds',
    startPrompt: 'Select a tournament above to get started.',
    selectDrawPrompt: 'Select a draw to view the bracket.',
    noMatchesScheduled: 'No matches scheduled for this day.',
    eventsEntered: 'Events Entered',
    matchResults: 'Match Results',
    matchHistory: 'Match History',
    yob: 'YOB',
    bye: 'Bye',
    walkover: 'Walkover',
    retired: 'Ret.',
    live: 'LIVE',
    nowPlaying: 'Now playing',
    noPlayerMatches: 'No match data available yet.',
    noH2HData: 'No H2H data available.',
    noH2HDiscipline: 'No matches for this discipline.',
    filterAll: 'All',
    filterSingles: 'Singles',
    filterDoubles: 'Doubles',
    filterMixed: 'Mixed',
    vs: 'vs',
    vsMatch: 'vs.',
    clearSearch: 'Clear search',
    highlight: 'Highlight',
    excludeCompleted: 'Excl. Completed',
    darkMode: 'Dark mode',
    lightMode: 'Light mode',
    close: 'Close',
    h2hButton: 'H2H',
    langToggle: 'ภาษาไทย',
    statsCareer: 'Career · this year in parens',
    statsSingles: 'Singles',
    statsDoubles: 'Doubles',
    statsMixed: 'Mixed',
    statsYearSuffix: 'YTD',
    liveMatches: 'Live Matches',
    jumpToNext: 'Next match ↓',
    scrollToTop: 'Top ↑',
    playingOrderNext: 'Up next',
    playingOrderAway: '{n} away',
    winRate: 'Win rate',
    bracketRoundHint: 'Tip: click a round header to collapse the bracket to that round.',
    searchNotFound: 'Search not found.  Searched player or team does not compete today',
    filterMatchCount: '{n} match{s}',
    searchHelp: 'Player name, club, or event. You can use & (and) or | (or) to search — e.g. kba & BS U15 will show only Kasemsak players in the U15 event.',
    pleaseSelectTournament: 'Please select a tournament',
    customTab: 'Custom',
    customTabCreate: 'New Custom Search',
    customTabEdit: 'Edit Custom Tab',
    customTabName: 'Tab name',
    customTabKeyword: 'Search keywords',
    customTabKeywordPlaceholder: 'Name, club, or event e.g. BD U15',
    customTabAddTooltip: 'Add custom tab',
    customTabSave: 'Save',
    customTabCancel: 'Cancel',
    customTabDelete: 'Delete',
    customTabDeleteConfirm: 'Confirm delete',
    customTabEditTabs: 'Edit tabs',
    customTabEditDone: 'Done',
    tournamentStats: 'Tournament stats',
    statsKpiEvents: 'Events',
    statsKpiMatches: 'Completed Matches',
    statsKpiPlayers: 'Players',
    statsKpiMultiEvent: 'Multi-event players',
    statsKpiCourtTime: 'Court time',
    statsKpiAvgMatch: 'Avg match',
    statsKpiThreeSetters: '3-setters',
    statsKpiComebacks: 'Comeback wins',
    statsSectionByNumbers: 'Tournament by Numbers',
    statsSectionMatchesPerDay: 'Matches per day / court time',
    statsSectionEvents: 'Events',
    statsSectionDrama: 'Match drama',
    statsSectionTopPlayers: 'Top players (by tournament wins)',
    statsSectionCourtUtilization: 'Court utilization',
    statsSectionClubMedals: 'Top clubs by medals',
    statsSectionClubRosters: 'Club / Team',
    statsSectionCountryRosters: 'Country',
    statsShowAll: 'Show all',
    statsShowLess: 'Show less',
    statsColCountry: 'Country',
    statsColPlayers: 'Players',
    statsSectionMultiGold: 'Players with multiple gold medals',
    statsSectionIntegrity: 'Other stats',
    statsMarathonBadge: 'Marathon',
    statsHighestSetBadge: 'Highest-scoring set',
    statsHighestScoringBadge: 'Highest-scoring match',
    statsComebacksBadge: 'comeback wins',
    statsMostCourtTimeBadge: 'Most court time',
    statsCol3Set: '3-set',
    statsColAvg: 'Avg',
    statsColMatches: 'Matches',
    statsColWinner: 'Winner(s)',
    statsColPlayer: 'Player',
    statsColClub: 'Club',
    statsColEvents: 'Events',
    statsColWL: 'W–L',
    statsEmptyState: "Competition hasn't started.  Check back when more matches are decided",
    statsLoadFailed: 'Could not load stats. Try again.',
    alertsTitle: 'Notifications',
    alertsNewTournaments: 'New tournaments',
    alertsNewSchedule: 'New Schedule Published',
    alertsNewRanking: 'New BAT Ranking',
    alertsRankingTitle: 'New BAT ranking published',
    alertsBellAria: 'Notifications',
    rankingDetailTitle: 'Ranking detail',
    rankingDetailTabSingles: 'Singles',
    rankingDetailTabDoubles: 'Doubles',
    rankingDetailTabMixed: 'Mixed',
    rankingDetailTopTen: 'Top 10 Tournaments',
    rankingDetailOthersTournaments: 'Others Tournaments',
    rankingDetailExpiringSoon: 'Will expire next ranking week',
    rankingDetailLoadFailed: "Couldn't load ranking detail.",
    rankingDetailRetry: 'Retry',
    rankingDetailEmpty: 'No ranking-eligible tournaments in the last 52 weeks.',
    viewFullProfile: 'View full profile',
    playerProfile: 'Player Profile',
    byDiscipline: 'By discipline',
    singles: 'Singles',
    doubles: 'Doubles',
    mixed: 'Mixed',
    tournamentHistory: 'Tournament history',
    recentForm: 'Recent form',
    matchCharacter: 'Match character',
    frequentOpponents: 'Frequent opponents',
    frequentPartners: 'Frequent partners',
    courtTime: 'Court time',
    avgMatch: 'Avg match',
    longestMatch: 'Longest match',
    threeSetterRate: 'Three-setter rate',
    comebackWins: 'Comeback wins',
    walkoversReceived: 'Walkovers received',
    walkoversGiven: 'Walkovers given',
    champion: 'Champion',
    leaderboards: 'Leaderboards',
    leaderboardsSub: 'Career titles · wins · win % · court time',
    lbHeadline: 'Headline',
    lbDiscipline: 'Event',
    lbCharacter: '3 Gamers',
    lbActivity: 'Activity',
    lbRanking: 'Ranking',
    lbRankingAsOf: 'Published',
    lbSearchPlaceholder: 'Search players…',
    lbSearchEmpty: 'No players found',
    currentRanking: 'Current Ranking',
    lbMostTitles: 'Most Titles',
    lbMostWins: 'Most Wins',
    lbHighestWinPct: 'Highest Win %',
    lbMostCourtTime: 'Most Court Time',
    lbBestSingles: 'Best Singles',
    lbBestDoubles: 'Best Doubles',
    lbBestMixed: 'Best Mixed',
    lbThreeSetterWins: 'Three-setter Wins',
    lbComebackWins: 'Comeback Wins',
    lbDeciderRecord: 'Decider Record',
    lb3Gamers: '3 Gamers',
    lbMatchesLast90: 'Matches (last 90 days)',
    lbTournamentsEntered: 'Tournaments Entered',
    min20: 'min 20 matches',
    min10: 'min 10 matches',
    min5: 'min 5 deciders',
    lbMostTitlesHelp: 'Number of events won (champion) across all included tournaments.',
    lbMostWinsHelp: 'Total matches won across all included tournaments.',
    lbHighestWinPctHelp: 'Share of matches won, among players with at least 20 matches played.',
    lbMostCourtTimeHelp: 'Total time spent on court, summed across all matches with a recorded duration.',
    lbBestSinglesHelp: 'Matches won in singles events. Requires at least 10 singles matches.',
    lbBestDoublesHelp: 'Matches won in doubles events. Requires at least 10 doubles matches.',
    lbBestMixedHelp: 'Matches won in mixed-doubles events. Requires at least 10 mixed matches.',
    lbThreeSetterWinsHelp: 'Matches won that went the full three games.',
    lbComebackWinsHelp: 'Matches won after losing the first game.',
    lbDeciderRecordHelp: 'Win rate in matches that reached a deciding third game. Requires at least 5 deciders.',
    lb3GamersHelp: 'Share of matches that went the full three games, out of all matches played.',
    lbMatchesLast90Help: 'Matches played in the last 90 days.',
    lbTournamentsEnteredHelp: 'Number of distinct tournaments entered.',
  },
  th: {
    appTitle1: 'BAT',
    appTitle2: 'Unofficial',
    appTitle3: 'Scoreboard',
    appSubtitle: 'กรุณาตรวจสอบความถูกต้องจากเว็บไซต์ BAT อีกครั้ง',
    tournament: 'รายการแข่งขัน',
    draw: 'ตารางแข่ง',
    trackLabel: 'ค้นหา',
    searchPlaceholder: 'ชื่อนักกีฬา ทีม หรือประเภท',
    selectTournament: '— เลือกรายการแข่งขัน —',
    pastEvents: 'รายการที่จบแล้ว',
    showPast: 'แสดงรายการเก่า',
    hidePast: 'ซ่อนรายการเก่า',
    selectDraw: '— เลือกตารางแข่ง —',
    noDraws: 'ไม่มีตารางแข่ง',
    loading: 'กำลังโหลด…',
    loadingBracket: 'กำลังโหลดตารางแข่ง…',
    loadingMatches: 'กำลังโหลดตารางแข่ง…',
    loadingPlayer: 'กำลังโหลดข้อมูลนักกีฬา…',
    loadingH2H: 'กำลังโหลดข้อมูล Head-to-Head…',
    exportJpg: '↓ บันทึกรูปภาพ',
    overview: 'ภาพรวม',
    tournamentInformation: 'ข้อมูลการแข่งขัน',
    seededEntries: 'การวางมือ',
    bracket: 'สายแข่ง',
    matchSchedule: 'ตารางเวลา',
    winner: 'ผู้ชนะ',
    notPlayed: 'ยังไม่แข่ง',
    trackedPlayer: 'นักกีฬาที่ติดตาม',
    viewingFrom: 'กำลังดูจาก',
    showAllRounds: '↩ แสดงทุกรอบ',
    startPrompt: 'เลือกรายการแข่งขันด้านบนเพื่อเริ่มต้น',
    selectDrawPrompt: 'เลือกตารางแข่งเพื่อดูสาย',
    noMatchesScheduled: 'ไม่มีการแข่งขันในวันนี้',
    eventsEntered: 'รายการที่ลงแข่ง',
    matchResults: 'ผลการแข่งขัน',
    matchHistory: 'ประวัติการพบกัน',
    yob: 'ปีเกิด',
    bye: 'บาย',
    walkover: 'บาย',
    retired: 'ถอน',
    live: 'สด',
    nowPlaying: 'กำลังแข่ง',
    noPlayerMatches: 'ยังไม่มีข้อมูลการแข่งขัน',
    noH2HData: 'ไม่มีข้อมูลการเจอกัน',
    noH2HDiscipline: 'ไม่มีข้อมูลในประเภทนี้',
    filterAll: 'ทั้งหมด',
    filterSingles: 'เดี่ยว',
    filterDoubles: 'คู่',
    filterMixed: 'คู่ผสม',
    vs: 'พบ',
    vsMatch: 'พบ',
    clearSearch: 'ล้างคำค้น',
    highlight: 'ไฮไลท์',
    excludeCompleted: 'ไม่รวมที่จบแล้ว',
    darkMode: 'โหมดมืด',
    lightMode: 'โหมดสว่าง',
    close: 'ปิด',
    h2hButton: 'H2H',
    langToggle: 'English',
    statsCareer: 'สถิติรวม · ในวงเล็บคือปีนี้',
    statsSingles: 'เดี่ยว',
    statsDoubles: 'คู่',
    statsMixed: 'คู่ผสม',
    statsYearSuffix: 'ปีนี้',
    liveMatches: 'แมตช์สด',
    jumpToNext: 'แมตช์ถัดไป ↓',
    scrollToTop: 'ขึ้นบน ↑',
    playingOrderNext: 'ถัดไป',
    playingOrderAway: 'อีก {n} คู่',
    winRate: 'อัตราการชนะ',
    bracketRoundHint: 'กดที่รอบแข่งเพื่อกระชับตารางแข่ง',
    searchNotFound: 'ไม่พบข้อมูลที่ค้นหา นักกีฬาหรือทีมที่ค้นหาไม่มีการแข่งขันในวันนี้',
    filterMatchCount: '{n} แมตช์',
    searchHelp: 'ชื่อนักกีฬา ทีม หรือประเภทแข่งขัน สามารถใช้ & (and) หรือ | (or) ในการค้นหาเช่น kba & BS U15 จะแสดงผลทีมเกษมศักดิ์ฯ ในรายการ U15 เท่านั้น',
    pleaseSelectTournament: 'เลือกรายการแข่งขัน',
    customTab: 'กำหนดเอง',
    customTabCreate: 'สร้างชุดค้นหาส่วนตัว',
    customTabEdit: 'แก้ไขการค้นหา',
    customTabName: 'ชื่อหัวข้อ',
    customTabKeyword: 'คำค้นหา',
    customTabKeywordPlaceholder: 'ชื่อนักกีฬา ทีม หรือรายการแข่งขัน เช่น BD U15',
    customTabAddTooltip: 'เพิ่มแท็บกำหนดเอง',
    customTabSave: 'บันทึก',
    customTabCancel: 'ยกเลิก',
    customTabDelete: 'ลบ',
    customTabDeleteConfirm: 'ยืนยันการลบ',
    customTabEditTabs: 'แก้ไขแท็บ',
    customTabEditDone: 'เสร็จ',
    tournamentStats: 'สถิติการแข่งขัน',
    statsKpiEvents: 'ประเภท',
    statsKpiMatches: 'แมตช์ที่จบแล้ว',
    statsKpiPlayers: 'นักกีฬา',
    statsKpiMultiEvent: 'นักกีฬาที่ลงมากกว่า 1 ประเภท',
    statsKpiCourtTime: 'เวลาสนามรวม',
    statsKpiAvgMatch: 'เวลาแข่งเฉลี่ยต่อแมตช์',
    statsKpiThreeSetters: '3 เกม',
    statsKpiComebacks: 'พลิกกลับมาชนะเกม 3 / โอกาสชนะหลังเสียเกมแรก',
    statsSectionByNumbers: 'เจาะลึกสถิติการแข่งขัน',
    statsSectionMatchesPerDay: 'แมตช์ต่อวัน / เวลาสนาม',
    statsSectionEvents: 'ประเภท',
    statsSectionDrama: 'แมตช์น่าจดจำ',
    statsSectionTopPlayers: 'นักกีฬายอดเยี่ยม',
    statsSectionCourtUtilization: 'การใช้งานสนาม',
    statsSectionClubMedals: 'สโมสรยอดเยี่ยม (เรียงตามเหรียญรางวัล)',
    statsSectionClubRosters: 'สโมสร / ทีม',
    statsSectionCountryRosters: 'ประเทศ',
    statsShowAll: 'แสดงทั้งหมด',
    statsShowLess: 'แสดงน้อยลง',
    statsColCountry: 'ประเทศ',
    statsColPlayers: 'จำนวนนักกีฬา',
    statsSectionMultiGold: 'นักกีฬาที่ได้เหรียญทองมากกว่า 1 เหรียญ',
    statsSectionIntegrity: 'สถิติอื่น ๆ',
    statsMarathonBadge: 'แมตช์มาราธอน',
    statsHighestSetBadge: 'เกมคะแนนสูงสุด',
    statsHighestScoringBadge: 'แมตช์คะแนนรวมสูงสุด',
    statsComebacksBadge: 'พลิกกลับมาชนะเกม 3',
    statsMostCourtTimeBadge: 'ใช้สนามมากที่สุด',
    statsCol3Set: '3 เกม',
    statsColAvg: 'เฉลี่ย',
    statsColMatches: 'แมตช์',
    statsColWinner: 'ผู้ชนะ',
    statsColPlayer: 'นักกีฬา',
    statsColClub: 'สโมสร',
    statsColEvents: 'ประเภท',
    statsColWL: 'ชนะ–แพ้',
    statsEmptyState: 'ยังไม่เริ่มการแข่งขัน',
    statsLoadFailed: 'ไม่สามารถโหลดสถิติได้ กรุณาลองใหม่',
    alertsTitle: 'การแจ้งเตือน',
    alertsNewTournaments: 'ทัวร์นาเมนต์ใหม่',
    alertsNewSchedule: 'ประกาศเวลาแข่งใหม่',
    alertsNewRanking: 'อันดับ BAT ใหม่',
    alertsRankingTitle: 'ประกาศอันดับ BAT ฉบับใหม่',
    alertsBellAria: 'การแจ้งเตือน',
    rankingDetailTitle: 'รายละเอียดอันดับ',
    rankingDetailTabSingles: 'เดี่ยว',
    rankingDetailTabDoubles: 'คู่',
    rankingDetailTabMixed: 'คู่ผสม',
    rankingDetailTopTen: 'ทัวร์นาเมนต์ 10 อันดับแรก',
    rankingDetailOthersTournaments: 'ทัวร์นาเมนต์อื่นๆ',
    rankingDetailExpiringSoon: 'แต้มจะถูกตัดออกในการประกาศอันดับครั้งถัดไป',
    rankingDetailLoadFailed: 'โหลดรายละเอียดอันดับไม่สำเร็จ',
    rankingDetailRetry: 'ลองอีกครั้ง',
    rankingDetailEmpty: 'ไม่มีรายการที่นับสะสมในรอบ 52 สัปดาห์ล่าสุด',
    viewFullProfile: 'ดูโปรไฟล์เต็ม',
    playerProfile: 'โปรไฟล์ผู้เล่น',
    byDiscipline: 'แยกตามประเภท',
    singles: 'เดี่ยว',
    doubles: 'คู่',
    mixed: 'คู่ผสม',
    tournamentHistory: 'ประวัติการแข่ง',
    recentForm: 'ฟอร์มล่าสุด',
    matchCharacter: 'ลักษณะการแข่ง',
    frequentOpponents: 'คู่ต่อสู้ที่พบบ่อย',
    frequentPartners: 'คู่ที่เล่นด้วยกันบ่อย',
    courtTime: 'เวลาในสนาม',
    avgMatch: 'แมตช์เฉลี่ย',
    longestMatch: 'แมตช์ยาวที่สุด',
    threeSetterRate: 'อัตราเกมสามเซต',
    comebackWins: 'ชนะแบบพลิกกลับมา',
    walkoversReceived: 'ได้บาย',
    walkoversGiven: 'ให้บาย',
    champion: 'แชมป์',
    leaderboards: 'ตารางอันดับ',
    leaderboardsSub: 'แชมป์ · ชนะ · เปอร์เซ็นต์ชนะ · เวลาในสนาม',
    lbHeadline: 'หลัก',
    lbDiscipline: 'ประเภท',
    lbCharacter: '3 เกม',
    lbActivity: 'กิจกรรม',
    lbRanking: 'อันดับ',
    lbRankingAsOf: 'แรงค์กิ้งของวันที่',
    lbSearchPlaceholder: 'ค้นหานักกีฬา…',
    lbSearchEmpty: 'ไม่พบนักกีฬา',
    currentRanking: 'อันดับปัจจุบัน',
    lbMostTitles: 'แชมป์มากที่สุด',
    lbMostWins: 'ชนะมากที่สุด',
    lbHighestWinPct: 'เปอร์เซ็นต์ชนะสูงสุด',
    lbMostCourtTime: 'เวลาในสนามมากที่สุด',
    lbBestSingles: 'เดี่ยวยอดเยี่ยม',
    lbBestDoubles: 'คู่ยอดเยี่ยม',
    lbBestMixed: 'คู่ผสมยอดเยี่ยม',
    lbThreeSetterWins: 'ชนะเกม 3',
    lbComebackWins: 'พลิกกลับมาชนะหลังเสียเกมแรก',
    lbDeciderRecord: 'สถิติชนะเกม 3',
    lb3Gamers: 'นักกีฬา 3 เกม',
    lbMatchesLast90: 'แมตช์ (90 วันล่าสุด)',
    lbTournamentsEntered: 'จำนวนทัวร์นาเมนต์',
    min20: 'อย่างน้อย 20 แมตช์',
    min10: 'อย่างน้อย 10 แมตช์',
    min5: 'อย่างน้อย 5 เซตตัดสิน',
    lbMostTitlesHelp: 'จำนวนรายการที่ชนะเลิศ (เป็นแชมป์) รวมจากทุกทัวร์นาเมนต์ที่นับรวม',
    lbMostWinsHelp: 'จำนวนแมตช์ที่ชนะทั้งหมด รวมจากทุกทัวร์นาเมนต์ที่นับรวม',
    lbHighestWinPctHelp: 'เปอร์เซ็นต์การชนะ เฉพาะผู้เล่นที่ลงแข่งอย่างน้อย 20 แมตช์',
    lbMostCourtTimeHelp: 'เวลารวมที่อยู่ในสนาม นับจากทุกแมตช์ที่มีการบันทึกเวลา',
    lbBestSinglesHelp: 'จำนวนแมตช์ที่ชนะในประเภทเดี่ยว ต้องลงเดี่ยวอย่างน้อย 10 แมตช์',
    lbBestDoublesHelp: 'จำนวนแมตช์ที่ชนะในประเภทคู่ ต้องลงคู่อย่างน้อย 10 แมตช์',
    lbBestMixedHelp: 'จำนวนแมตช์ที่ชนะในประเภทคู่ผสม ต้องลงคู่ผสมอย่างน้อย 10 แมตช์',
    lbThreeSetterWinsHelp: 'จำนวนแมตช์ที่ชนะโดยเล่นครบสามเกม',
    lbComebackWinsHelp: 'จำนวนแมตช์ที่ชนะหลังจากแพ้เกมแรก',
    lbDeciderRecordHelp: 'อัตราการชนะในแมตช์ที่ต้องตัดสินด้วยเกมที่สาม ต้องมีเกมตัดสินอย่างน้อย 5 ครั้ง',
    lb3GamersHelp: 'สัดส่วนแมตช์ที่เล่นครบ 3 เกม เทียบกับแมตช์ทั้งหมดที่ลงแข่ง',
    lbMatchesLast90Help: 'จำนวนแมตช์ที่ลงแข่งใน 90 วันที่ผ่านมา',
    lbTournamentsEnteredHelp: 'จำนวนทัวร์นาเมนต์ที่เข้าร่วม (ไม่ซ้ำ)',
  },
}

export function translate(key: TKey, lang: Lang): string {
  return dict[lang][key] ?? dict.en[key] ?? key
}
