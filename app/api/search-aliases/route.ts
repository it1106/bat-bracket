import { NextResponse } from 'next/server'
import { aliasStore } from '@/lib/search-aliases-store'

export const dynamic = 'force-dynamic'

// GET /api/search-aliases  →  { aliases: { short: full, … } }
// Public: every visitor's search box expands these. Managed on /bmstats.
export async function GET() {
  return NextResponse.json({ aliases: aliasStore().list() }, { headers: { 'Cache-Control': 'no-store' } })
}
