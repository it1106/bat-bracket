import type { WLRecord } from './types'

export function pct(record: WLRecord): number | null {
  const total = record.wins + record.losses
  if (total === 0) return null
  return Math.round((record.wins / total) * 100)
}
