'use client'

import { toJpeg } from 'html-to-image'
import { prewarmFontEmbedCSS } from './shareMatchAsImage'
import type { TeamScheduleRow } from './teamSchedule'

// Renders a team's schedule for one day as a JPEG: a compact table built just
// for the picture (not a screenshot of the page), in fixed light colours so it
// looks the same whatever theme the reader uses.

export interface TeamScheduleImage {
  tournamentName: string
  /** Who the schedule is for: a custom tab's name or the search text. */
  teamLabel: string
  dateLabel: string
  rows: TeamScheduleRow[]
  /** Words that follow the reader's language. */
  labels: { nowPlaying: string; disclaimer: string; playsAgain: string; or: string }
}

const FONT = `'Segoe UI', system-ui, -apple-system, 'Noto Sans Thai', sans-serif`
const INK = '#1a1a1a'
const MUTED = '#6b7280'
const BRAND = '#25316B'
const LINE = '#e5e7eb'
const WON = '#166534'
const LOST = '#b91c1c'
const WIDTH = 600

function el(tag: string, css: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.style.cssText = css
  if (text !== undefined) node.textContent = text
  return node
}

// The right-hand column: the result of a finished match, or — for one still
// to be played — when the team plays again the same day if it wins.
function resultCell(row: TeamScheduleRow, labels: TeamScheduleImage['labels']): HTMLElement {
  const cell = el('div', `width:120px;flex-shrink:0;text-align:right;font-size:13px;font-weight:700;`)
  if (row.status === 'live') {
    cell.append(el('span', `color:${WON};background:#e8f5e9;border-radius:999px;padding:2px 8px;font-size:12px;`, labels.nowPlaying))
  }
  if (row.nextTime) {
    cell.append(
      el('div', `font-size:10px;font-weight:500;color:${MUTED};${row.status === 'live' ? 'margin-top:5px;' : ''}`, labels.playsAgain),
      el('div', `font-size:14px;font-weight:700;color:${BRAND};`, row.nextTime),
    )
  } else if (row.status === 'won' || row.status === 'lost') {
    const colour = row.status === 'won' ? WON : LOST
    cell.append(
      el('div', `color:${colour};`, row.status === 'won' ? 'W' : 'L'),
      el('div', `color:${colour};font-weight:600;font-size:12px;`, row.result),
    )
  } else if (row.status === 'played') {
    cell.append(el('div', `color:${INK};font-weight:600;font-size:12px;`, row.result))
  }
  return cell
}

/** The court most of the rows share (more than half of them), or '' if none. */
export function commonCourt(rows: TeamScheduleRow[]): string {
  const counts = new Map<string, number>()
  for (const { court } of rows) if (court) counts.set(court, (counts.get(court) ?? 0) + 1)
  let best = ''
  let bestCount = 0
  counts.forEach((count, court) => {
    if (count > bestCount) {
      best = court
      bestCount = count
    }
  })
  return rows.length > 1 && bestCount > rows.length / 2 ? best : ''
}

/** Builds the picture's DOM. Text only goes in through textContent. */
export function buildTeamScheduleNode(image: TeamScheduleImage): HTMLElement {
  const root = el('div', `width:${WIDTH}px;background:#ffffff;color:${INK};font-family:${FONT};padding:18px 18px 14px;box-sizing:border-box;`)

  // When most matches are at the same place (the venue, on days scheduled by
  // time), say it once in the header; a row then shows its court only if it
  // differs — as a match in play does, once it has been given a court.
  const sharedCourt = commonCourt(image.rows)
  // Nothing to put in the right-hand column (no results, nobody playing, no
  // same-day next match): leave it out so the names get the room.
  const showResults = image.rows.some((r) => r.status !== 'upcoming' || r.nextTime !== '')

  const everyRowAtSharedCourt = sharedCourt !== '' && image.rows.every((r) => r.court === sharedCourt)

  root.append(
    el('div', `font-size:17px;font-weight:700;color:${BRAND};line-height:1.3;`, image.tournamentName),
    el('div', `font-size:14px;font-weight:600;margin-top:4px;`, `${image.teamLabel} · ${image.dateLabel}`),
  )
  if (sharedCourt) root.append(el('div', `font-size:12px;color:${INK};margin-top:2px;`, sharedCourt))
  root.append(
    el('div', `font-size:11px;color:${MUTED};margin-top:2px;padding-bottom:10px;border-bottom:2px solid ${BRAND};`, image.labels.disclaimer),
  )

  image.rows.forEach((row, i) => {
    const line = el('div', `display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:1px solid ${LINE};`)

    // A running number, so a match can be pointed at ("the 3rd one").
    const index = el('div', `width:20px;flex-shrink:0;text-align:right;font-size:13px;line-height:20px;color:${MUTED};`, String(i + 1))

    const when = el('div', `width:${everyRowAtSharedCourt ? 64 : 112}px;flex-shrink:0;`)
    when.append(el('div', `font-size:15px;font-weight:700;`, row.when || row.order || '–'))
    const place = [row.when && row.order, row.court === sharedCourt ? '' : row.court].filter(Boolean).join(' · ')
    if (place) when.append(el('div', `font-size:11px;color:${MUTED};margin-top:1px;`, place))

    const event = el('div', `width:86px;flex-shrink:0;`)
    event.append(
      el('div', `font-size:13px;font-weight:700;color:${BRAND};`, row.event),
      el('div', `font-size:11px;color:${MUTED};margin-top:1px;`, row.round),
    )

    const players = el('div', `flex:1;min-width:0;`)
    players.append(el('div', `font-size:14px;font-weight:700;line-height:1.35;`, row.team.join(' / ') || '–'))
    players.append(el(
      'div',
      `font-size:13px;line-height:1.35;margin-top:1px;${row.bothSides ? 'font-weight:700;' : `color:${MUTED};`}`,
      `vs ${row.opponent.join(' / ') || row.opponentCandidates.join(` ${image.labels.or} `) || '–'}`,
    ))

    line.append(index, when, event, players)
    if (showResults) line.append(resultCell(row, image.labels))
    root.append(line)
  })

  const stamp = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  root.append(el('div', `font-size:10px;color:${MUTED};margin-top:10px;text-align:right;`, `batmatch.app · ${stamp}`))
  return root
}

export function teamScheduleFilename(teamLabel: string, dateLabel: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, '-').replace(/^-+|-+$/g, '')
  return `${[slug(teamLabel), slug(dateLabel)].filter(Boolean).join('-') || 'schedule'}.jpg`.slice(0, 80)
}

export async function captureTeamScheduleFile(image: TeamScheduleImage): Promise<File> {
  // In the DOM at a real on-screen position (iOS Safari renders nothing for an
  // off-screen node) but behind the page, as lib/shareMatchAsImage does.
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;'
  wrapper.append(buildTeamScheduleNode(image))
  document.body.appendChild(wrapper)
  try {
    if (document.fonts?.ready) {
      try { await document.fonts.ready } catch { /* ignore */ }
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const node = wrapper.firstElementChild as HTMLElement
    const dataUrl = await toJpeg(node, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: node.scrollWidth,
      height: node.scrollHeight,
      fontEmbedCSS: await prewarmFontEmbedCSS(),
    })
    const blob = await (await fetch(dataUrl)).blob()
    return new File([blob], teamScheduleFilename(image.teamLabel, image.dateLabel), { type: 'image/jpeg' })
  } finally {
    document.body.removeChild(wrapper)
  }
}
