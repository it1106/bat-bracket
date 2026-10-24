// The slices of the "By device" donut on /bmstats: today's visitors by the
// operating system their browser reported.
//
// Unlike countries, the set is closed (lib/push/user-agent knows six words,
// plus "unknown"), so every one of them gets a slice and a colour of its own
// and nothing is folded into "Other". A colour belongs to a platform, not to
// its rank, so the ring does not repaint when two of them swap places.

import { UNKNOWN_PLATFORM } from './presence'
import type { DonutSlice } from './donut'

// Colour slot per platform; the unknown slice keeps the grey slot 0. Written
// out rather than counted off DEVICE_OSES, so adding a platform there does not
// repaint the ring. iPadOS wears slot 7, a lighter blue than the iOS slot 1:
// the two Apple handhelds are the one pair worth confusing.
const SLOTS: Record<string, number> = {
  iOS: 1, Android: 2, macOS: 3, Windows: 4, Linux: 5, ChromeOS: 6, iPadOS: 7,
}

/** "iOS" for "iOS", "Unknown" for a device we could not place. */
export function platformName(key: string): string {
  return key === UNKNOWN_PLATFORM ? 'Unknown' : key
}

/** The donut's slices, most devices first with "Unknown" last. */
export function platformSlices(platforms: Array<{ platform: string; count: number }>): DonutSlice[] {
  const rows = platforms.filter((p) => p.count > 0)
  const total = rows.reduce((sum, p) => sum + p.count, 0)
  if (total === 0) return []
  // Unknown is not a device anyone has, so it sits last however many there are.
  const unknownLast = (p: { platform: string }) => (p.platform === UNKNOWN_PLATFORM ? 1 : 0)
  return rows
    .sort((a, b) =>
      unknownLast(a) - unknownLast(b) || b.count - a.count || a.platform.localeCompare(b.platform))
    .map((p) => ({
      key: p.platform,
      name: platformName(p.platform),
      count: p.count,
      percent: (p.count / total) * 100,
      slot: SLOTS[p.platform] ?? 0,
    }))
}
