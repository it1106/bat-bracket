import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import type { ProviderTag } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(_req: Request, ctx: { params: { provider: string; slug: string } }) {
  const provider = ctx.params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const index = await readIndexCache(provider)
  if (!index) return NextResponse.json({ error: 'index not built' }, { status: 404 })
  const record = index.players[ctx.params.slug]
  if (!record) return NextResponse.json({ error: 'player not found' }, { status: 404 })
  return NextResponse.json({ record, indexGeneratedAt: index.generatedAt })
}
