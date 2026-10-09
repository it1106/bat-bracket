import { NextResponse } from 'next/server'
import { pushConfig } from '@/lib/push/config'

export const dynamic = 'force-dynamic'

// The public half of the push key pair: a browser needs it to subscribe. 404
// tells the page the feature is off.
export async function GET() {
  const config = pushConfig()
  if (!config) return NextResponse.json({ error: 'match alerts are not set up' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ publicKey: config.publicKey }, { headers: { 'Cache-Control': 'no-store' } })
}
