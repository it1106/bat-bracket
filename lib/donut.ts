// What every donut on /bmstats is drawn from: a handful of named slices with
// a colour slot each. lib/countryDonut and lib/platformDonut work out the
// slices; components/StatDonut draws them.

export interface DonutSlice {
  /** Identifies the slice within its donut, e.g. a country code or 'other'. */
  key: string
  name: string
  count: number
  /** 0–100. */
  percent: number
  /** Colour slot 1–6, or 0 for the grey one ("Other", "Unknown"). */
  slot: number
}

/** "95.2%", "<0.1%" for a sliver, "100%" for everything. */
export function percentLabel(percent: number): string {
  if (percent >= 99.95) return '100%'
  if (percent > 0 && percent < 0.1) return '<0.1%'
  return `${percent.toFixed(1)}%`
}
