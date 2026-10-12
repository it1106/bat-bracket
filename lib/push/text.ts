import type { MatchEntry, MatchPlayer } from '@/lib/types'
import { abbrevRoundL, type Lang } from '@/lib/i18n'
import type { DueAlert, Publication, PublicationKind, PushPayload } from './types'

const names = (team: MatchPlayer[]) => team.map((p) => p.name).join(' / ')

/** The match's stable name on a device: `next` replaces `soon` under it. */
export function matchTag(m: MatchEntry): string {
  const ids = [...m.team1, ...m.team2].map((p) => p.playerId || p.name).sort().join(',')
  return `${m.drawNum}|${ids}`
}

function title(alert: DueAlert): string {
  // The same words the site itself uses for a match on court (i18n nowPlaying).
  if (alert.stage === 'playing') return alert.lang === 'th' ? 'กำลังแข่ง' : 'Now Playing'
  const n = Math.max(1, alert.position - 1)
  if (alert.lang === 'th') return `อีกประมาณ ${n} คู่`
  return n === 1 ? 'About 1 match away' : `About ${n} matches away`
}

/** Both sides of the match, the followed one first. When both are followed,
 *  or neither can be told, the page's own order stands. */
function sides(alert: DueAlert): [MatchPlayer[], MatchPlayer[]] {
  const { team1, team2 } = alert.match
  const mine = new Set(alert.players.map((p) => p.playerId || p.name))
  const has = (team: MatchPlayer[]) => team.some((p) => mine.has(p.playerId || p.name))
  return has(team2) && !has(team1) ? [team2, team1] : [team1, team2]
}

const urlFor = (tournamentId: string) => `/?tournament=${tournamentId}`

export function alertPayload(alert: DueAlert, tournamentId: string): PushPayload {
  const lang: Lang = alert.lang
  const [a, b] = sides(alert)
  const versus = lang === 'th' ? 'พบ' : 'vs'
  const m = alert.match
  const parts = [`${names(a)} ${versus} ${names(b)}`, `${m.draw} ${abbrevRoundL(m.round, lang)}`.trim()]
  if (m.court) parts.push(m.court)
  return { title: title(alert), body: parts.join(' · '), url: urlFor(tournamentId), tag: matchTag(m) }
}

/** A finished match, told from the followed player's side: "Won 15-2, 15-4".
 *  With both sides followed it takes neither: "A beat B 15-2, 15-4". */
export function resultPayload(alert: DueAlert, tournamentId: string): PushPayload {
  const th = alert.lang === 'th'
  const m = alert.match
  const [a, b] = sides(alert)
  const mine = new Set(alert.players.map((p) => p.playerId || p.name))
  const has = (team: MatchPlayer[]) => team.some((p) => mine.has(p.playerId || p.name))
  const neutral = has(m.team1) === has(m.team2)
  const round = `${m.draw} ${abbrevRoundL(m.round, alert.lang)}`.trim()
  const base = { url: urlFor(tournamentId), tag: matchTag(m) }

  if (neutral) {
    const [winner, loser] = m.winner === 2 ? [m.team2, m.team1] : [m.team1, m.team2]
    const score = m.scores.map((s) => (m.winner === 2 ? `${s.t2}-${s.t1}` : `${s.t1}-${s.t2}`)).join(', ')
    const line = [`${names(winner)} ${th ? 'ชนะ' : 'beat'} ${names(loser)}`, score].filter(Boolean).join(' ')
    return { title: th ? 'ผลการแข่งขัน' : 'Result', body: `${line} · ${round}`, ...base }
  }

  const mineIsTeam1 = a === m.team1
  const won = (m.winner === 1) === mineIsTeam1
  const score = m.scores.map((s) => (mineIsTeam1 ? `${s.t1}-${s.t2}` : `${s.t2}-${s.t1}`)).join(', ')
  let title: string
  if (m.walkover) {
    title = th ? (won ? 'ชนะ (คู่แข่งถอนตัว)' : 'แพ้ (ถอนตัว)') : won ? 'Won by walkover' : 'Lost by walkover'
  } else {
    title = [th ? (won ? 'ชนะ' : 'แพ้') : won ? 'Won' : 'Lost', score].filter(Boolean).join(' ')
    if (m.retired) title += th ? ' (รีไทร์)' : ' (retired)'
  }
  return { title, body: `${names(a)} ${th ? 'พบ' : 'vs'} ${names(b)} · ${round}`, ...base }
}

const DIGEST_LINES = 4

/** Several alerts for one device in one tick, as a single notification: the
 *  nearest match first, a few lines, then a count of the rest. */
export function digestPayload(alerts: DueAlert[], tournamentId: string, minuteKey: string): PushPayload {
  const lang: Lang = alerts[0]?.lang ?? 'en'
  const sorted = alerts.slice().sort((x, y) => x.position - y.position)
  const lines = sorted.slice(0, DIGEST_LINES).map((a) => {
    const parts = [names(a.players.length > 0 ? a.players : a.match.team1), a.match.draw]
    if (a.match.court) parts.push(a.match.court)
    return parts.join(' · ')
  })
  const rest = sorted.length - DIGEST_LINES
  if (rest > 0) lines.push(lang === 'th' ? `+อีก ${rest} คู่` : `+${rest} more`)
  return {
    title: lang === 'th' ? `อีก ${sorted.length} คู่ใกล้ถึงคิว` : `${sorted.length} matches coming up`,
    body: lines.join('\n'),
    url: urlFor(tournamentId),
    tag: `${tournamentId}|${minuteKey}`,
  }
}

const PUB_TITLES: Record<PublicationKind, { en: string; th: string }> = {
  tournament: { en: 'New tournament', th: 'ทัวร์นาเมนต์ใหม่' },
  bracket: { en: 'Draws are out', th: 'สายการแข่งขันออกแล้ว' },
  schedule: { en: 'Schedule published', th: 'ตารางแข่งออกแล้ว' },
}

// Written out rather than formatted with Intl: this runs on the server, where
// the available locale data is not something a notification should depend on.
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** "2026-10-20" as "20 Oct" / "20 ต.ค.". Anything not a date is left alone. */
function shortDate(dateIso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso)
  if (!m) return dateIso
  const month = (lang === 'th' ? MONTHS_TH : MONTHS_EN)[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month}` : dateIso
}

const PUB_ITEMS = 4
const TAG_LETTER: Record<PublicationKind, string> = { tournament: 't', bracket: 'b', schedule: 's' }

/** One newly published thing, for one device, in its language. The tag's `pub:`
 *  prefix keeps it from replacing a match alert (whose tag is `<drawNum>|<ids>`);
 *  the minute key lets a second batch of draws stand beside the first instead
 *  of overwriting it. A tournament is announced once ever, so its tag has no
 *  minute in it. */
export function publicationPayload(pub: Publication, lang: Lang, minuteKey: string): PushPayload {
  const th = lang === 'th'
  const shown = pub.items.slice(0, PUB_ITEMS).map((i) => (pub.kind === 'schedule' ? shortDate(i, lang) : i))
  const rest = pub.items.length - shown.length
  const list = shown.join(', ') + (rest > 0 ? (th ? ` +อีก ${rest}` : ` +${rest} more`) : '')
  const title = PUB_TITLES[pub.kind][th ? 'th' : 'en']
  const letter = TAG_LETTER[pub.kind]
  return {
    title,
    body: [pub.tournamentName, list].filter(Boolean).join(' · '),
    url: `/?tournament=${pub.tournamentId}`,
    tag: pub.kind === 'tournament' ? `pub:t:${pub.tournamentId}` : `pub:${letter}:${pub.tournamentId}:${minuteKey}`,
  }
}
