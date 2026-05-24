// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

import type { Discipline } from './types'

const SEED_PREFIX_RE = /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*/

export function nameToSlug(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(SEED_PREFIX_RE, '').trim()
  if (!s) return ''
  s = s.toLowerCase()
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.map(p => encodeURIComponent(p)).join('_')
}

const ROUND_MAP: Array<[RegExp, string]> = [
  [/^(round\s*of\s*128|r128|1\/64)$/i, 'R128'],
  [/^(round\s*of\s*64|r64|1\/32)$/i, 'R64'],
  [/^(round\s*of\s*32|r32|1\/16)$/i, 'R32'],
  [/^(round\s*of\s*16|r16|1\/8)$/i, 'R16'],
  [/^(quarter[-\s]?final|qf|1\/4)$/i, 'QF'],
  [/^(semi[-\s]?final|sf|1\/2)$/i, 'SF'],
  [/^(final|f)$/i, 'Final'],
  [/^(round[-\s]?robin|rr|group(\s+\w+)?|pool(\s+\w+)?)$/i, 'RR'],
]

const ROUND_THAI: Record<string, string> = {
  'รอบชิงชนะเลิศ': 'Final',
  'รอบรองชนะเลิศ': 'SF',
  'รอบก่อนรองชนะเลิศ': 'QF',
}

export function normalizeRound(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return 'RR'
  if (ROUND_THAI[s]) return ROUND_THAI[s]
  for (const [re, label] of ROUND_MAP) {
    if (re.test(s)) return label
  }
  return 'RR'
}

const MIXED_RE = /(mixed|xd\b)/i

export function classifyDiscipline(teamSize: number, eventName: string): Discipline {
  if (teamSize <= 1) return 'singles'
  if (MIXED_RE.test(eventName)) return 'mixed'
  return 'doubles'
}
