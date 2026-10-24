'use client'

import StatDonut from '@/components/StatDonut'
import { platformSlices } from '@/lib/platformDonut'

/** Today's users by the kind of device they came on. */
export default function PlatformDonut({ platforms }: {
  platforms: Array<{ platform: string; count: number }>
}) {
  return <StatDonut slices={platformSlices(platforms)} noun="user" category="device" />
}
