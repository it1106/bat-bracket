import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import type { ProviderTag } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])
const LIMIT = 15

interface SearchHit { slug: string; name: string; club: string; provider: ProviderTag }

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const q = (u.searchParams.get('q') ?? '').trim().toLowerCase()
  if (!provider || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provider required' }, { status: 400 })
  }
  if (q.length < 1) return NextResponse.json({ hits: [] })

  const index = await readIndexCache(provider)
  if (!index) return NextResponse.json({ hits: [] })

  const scored: Array<{ hit: SearchHit; score: number }> = []
  for (const rec of Object.values(index.players)) {
    const names = [rec.displayName, ...rec.altNames].map(n => n.toLowerCase())
    let score = Infinity
    for (const n of names) {
      const idx = n.indexOf(q)
      if (idx === -1) continue
      // Prefix match (idx 0) ranks best; earlier match position ranks higher.
      score = Math.min(score, idx)
    }
    if (score === Infinity) continue
    scored.push({ hit: { slug: rec.key.slug, name: rec.displayName, club: rec.clubs[0] ?? '', provider }, score })
  }

  scored.sort((a, b) => a.score - b.score || a.hit.name.localeCompare(b.hit.name))
  return NextResponse.json({ hits: scored.slice(0, LIMIT).map(s => s.hit) })
}
