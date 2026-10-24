'use client'

import StatDonut from '@/components/StatDonut'
import { countrySlices } from '@/lib/countryDonut'

/** Today's site requests, or users, by the visitor's country. */
export default function CountryDonut({ countries, noun = 'request' }: {
  countries: Array<{ country: string; count: number }>
  /** What one unit is, singular: "request", "user". */
  noun?: string
}) {
  return <StatDonut slices={countrySlices(countries)} noun={noun} category="country" />
}
