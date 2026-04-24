import { NextResponse } from 'next/server'

const UPSTREAM = 'https://livescore.tournamentsoftware.com'
const ALLOWED_OPS = new Set(['negotiate', 'start', 'abort'])

export const maxDuration = 10

export async function GET(
  request: Request,
  { params }: { params: { op: string } },
) {
  const { op } = params
  if (!ALLOWED_OPS.has(op)) {
    return NextResponse.json({ error: 'unknown op' }, { status: 404 })
  }
  const url = new URL(request.url)
  const target = `${UPSTREAM}/signalr/${op}?${url.searchParams}`
  try {
    const res = await fetch(target)
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Upstream failed: ${message}` }, { status: 502 })
  }
}
