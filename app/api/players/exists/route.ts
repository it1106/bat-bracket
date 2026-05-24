import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { nameToSlug } from '@/lib/playerIndex'
import type { ProviderTag } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const name = u.searchParams.get('name')
  if (!provider || !name || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provider and name required' }, { status: 400 })
  }
  const slug = nameToSlug(name)
  const index = await readIndexCache(provider)
  const exists = !!index?.players[slug]
  return NextResponse.json({ exists, slug })
}
