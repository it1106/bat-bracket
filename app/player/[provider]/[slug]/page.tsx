import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()
  return <PlayerProfileView record={record} />
}

export const dynamic = 'force-dynamic'
