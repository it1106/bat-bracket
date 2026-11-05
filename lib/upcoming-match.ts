// What a match that hasn't been played yet can say about itself: when it
// starts, which court it is on, and where it sits in that court's queue.
//
// The two providers word this differently. BAT's scheduledTime is already a
// label from its own calendar ("ศ. 15/5/2569 10:30"), while BWF sends a
// machine timestamp ("2026-11-05 12:00:00") that has to be cut down before it
// can sit in a narrow column. The court and the queue position live in the
// same fields for both, so everything here reads the data, not the provider.

/** A readable day and time. A timestamp becomes "DD/MM/YY HH:MM"; anything
 *  else — BAT's own label — is already readable and passes through. */
export function formatMatchTime(raw: string): string {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return raw
  const [, yyyy, mm, dd, hh, mi] = m
  return `${dd}/${mm}/${yyyy.slice(2)} ${hh}:${mi}`
}

type Scheduled = { court?: string; sequenceLabel?: string }

// A source keeps a planned court on a match whose order-of-play line says the
// court is not settled ("Court and time TBA"), so printing it would send a
// player to a court the source itself doesn't stand behind. Only the TBA
// wording about the court hides it: "Followed by", "Not before 2:00 PM" and
// "Starting at 10:00 AM" are real assignments, and a "Time TBA" line keeps
// its court. Same rule as the bracket's courtIsTba.
function courtIsTba(label: string | undefined): boolean {
  if (!label) return false
  return /court/i.test(label) && /\bTBA\b/i.test(label)
}

/** The court to show for an upcoming match, or '' when there is none to
 *  stand behind. BAT writes "Now playing" in this field for a match it has
 *  put on court without naming which, so that is not a court either. */
export function upcomingCourt(m: Scheduled): string {
  const court = (m.court ?? '').trim()
  if (!court || /^now\s*playing$/i.test(court)) return ''
  return courtIsTba(m.sequenceLabel) ? '' : court
}

/** The match's position in its court's queue — the number both providers
 *  print as "6. Followed by" — or '' when there is no court to queue on. */
export function upcomingMatchNo(m: Scheduled): string {
  if (!upcomingCourt(m)) return ''
  const n = (m.sequenceLabel ?? '').match(/^\s*(\d+)\./)
  return n ? n[1] : ''
}
