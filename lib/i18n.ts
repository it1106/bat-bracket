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
    if (r.kind === 'roundOf') return `รอบ ${r.n} คน`
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
  | 'selectDraw'
  | 'noDraws'
  | 'loading'
  | 'loadingBracket'
  | 'loadingMatches'
  | 'loadingPlayer'
  | 'loadingH2H'
  | 'exportJpg'
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
  | 'close'
  | 'h2hButton'
  | 'langToggle'
  | 'statsCareer'
  | 'statsSingles'
  | 'statsDoubles'
  | 'statsMixed'
  | 'statsYearSuffix'

const dict: Record<Lang, Record<TKey, string>> = {
  en: {
    appTitle1: 'BAT',
    appTitle2: 'Unofficial',
    appTitle3: 'Scores',
    appSubtitle: 'Check BAT official website for accuracy',
    tournament: 'Tournament',
    draw: 'Draw',
    trackLabel: 'Search',
    searchPlaceholder: 'Search player, club, or event',
    selectTournament: '— Select tournament —',
    selectDraw: '— Select draw —',
    noDraws: 'No draws',
    loading: 'Loading…',
    loadingBracket: 'Loading bracket…',
    loadingMatches: 'Loading matches…',
    loadingPlayer: 'Loading player profile…',
    loadingH2H: 'Loading H2H data…',
    exportJpg: '↓ Export JPG',
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
    close: 'Close',
    h2hButton: 'H2H',
    langToggle: 'ภาษาไทย',
    statsCareer: 'Career · this year in parens',
    statsSingles: 'Singles',
    statsDoubles: 'Doubles',
    statsMixed: 'Mixed',
    statsYearSuffix: 'YTD',
  },
  th: {
    appTitle1: 'BAT',
    appTitle2: 'Unofficial',
    appTitle3: 'Scores',
    appSubtitle: 'กรุณาตรวจสอบความถูกต้องจากเว็บไซต์ BAT อีกครั้ง',
    tournament: 'รายการแข่งขัน',
    draw: 'ตารางแข่ง',
    trackLabel: 'ค้นหา',
    searchPlaceholder: 'ชื่อนักกีฬา ทีม หรือประเภท เช่น BS U13',
    selectTournament: '— เลือกรายการแข่งขัน —',
    selectDraw: '— เลือกตารางแข่ง —',
    noDraws: 'ไม่มีตารางแข่ง',
    loading: 'กำลังโหลด…',
    loadingBracket: 'กำลังโหลดตารางแข่ง…',
    loadingMatches: 'กำลังโหลดตารางเวลา…',
    loadingPlayer: 'กำลังโหลดข้อมูลนักกีฬา…',
    loadingH2H: 'กำลังโหลดข้อมูล Head-to-Head…',
    exportJpg: '↓ บันทึกรูปภาพ',
    bracket: 'ตารางแข่ง',
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
    walkover: 'ชนะบาย',
    retired: 'ถอน',
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
    close: 'ปิด',
    h2hButton: 'H2H',
    langToggle: 'English',
    statsCareer: 'สถิติรวม · ในวงเล็บคือปีนี้',
    statsSingles: 'เดี่ยว',
    statsDoubles: 'คู่',
    statsMixed: 'คู่ผสม',
    statsYearSuffix: 'ปีนี้',
  },
}

export function translate(key: TKey, lang: Lang): string {
  return dict[lang][key] ?? dict.en[key] ?? key
}
