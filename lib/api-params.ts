import { NextResponse } from 'next/server'
import { isGuid } from './push/validate'

// Checks for the values visitors put in an API address. Every one of them
// ends up inside an address the server asks BAT or BWF for, or in a cache
// key, so each is held to the one shape the real thing has before it is used.

/** A tournament id: BAT's GUID, which BWF tournaments are registered under too. */
export const isTournamentId = isGuid

/** A schedule day as the client sends it: BAT's Buddhist-year YYYYMMDD
 *  ("25691102") or BWF's ISO date ("2026-11-02"). */
export function isScheduleDate(value: unknown): value is string {
  return typeof value === 'string' && /^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(value)
}

/** A draw number: a small integer on BAT and on BWF alike. */
export function isDrawNum(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,6}$/.test(value)
}

/** A player id, local to a tournament on BAT and global on BWF. */
export function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,12}$/.test(value)
}

export function badParam(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
}
