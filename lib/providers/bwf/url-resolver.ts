export interface BwfPageMeta {
  tmtId: number
  tournamentCode: string
  slug: string
  name: string
  token: string
}

const RX = {
  // matches `mainTmtId: 5726,` — use mainTmtId (more authoritative)
  tmtId: /\bmainTmtId\s*:\s*(\d+)/,
  tournamentCode: /\btournamentCode\s*:\s*['"]([0-9A-Fa-f-]{36})['"]/,
  slug: /\btournamentSlug\s*:\s*['"]([^'"]+)['"]/,
  // title looks like: <title>Tournament | MITH YONEX ...</title>
  name: /<title>\s*[^|<]*\|\s*([^<]+?)\s*<\/title>/,
  // The token has shipped in two shapes: a JS object literal (`token: "..."`)
  // and, since the site's 2026 rework, HTML-entity-encoded JSON inside an
  // element attribute (`&quot;token&quot;:&quot;...&quot;`). Accept an optional
  // quote — real or the &quot; entity — around the key, and either quote style
  // around the value. The value class excludes & so it stops at the closing
  // &quot; entity rather than swallowing it.
  token: /(?:&quot;|["'])?\btoken\b(?:&quot;|["'])?\s*:\s*(?:&quot;|["'])([^"'&]+)(?:&quot;|["'])/,
}

export function extractTokenFromHtml(html: string): string | null {
  return RX.token.exec(html)?.[1] ?? null
}

export function extractMetaFromPageHtml(html: string): BwfPageMeta | null {
  const tmtId = RX.tmtId.exec(html)?.[1]
  const tournamentCode = RX.tournamentCode.exec(html)?.[1]
  const slug = RX.slug.exec(html)?.[1]
  const name = RX.name.exec(html)?.[1]
  const token = RX.token.exec(html)?.[1]
  if (!tmtId || !tournamentCode || !slug || !name || !token) return null
  return {
    tmtId: Number(tmtId),
    tournamentCode: tournamentCode.toUpperCase(),
    slug,
    name,
    token,
  }
}

// The numeric tournament id lives in the path: /tournament/<id>/<slug>/…
const TMT_ID_IN_URL = /\/tournament\/(\d+)(?:\/|$)/

export function parseTmtIdFromBwfUrl(url: string): number | null {
  const m = TMT_ID_IN_URL.exec(url)
  return m ? Number(m[1]) : null
}

// Sidecar fields (everything a SidecarEntry needs except resolvedAt), the shape
// saveSidecarEntry consumes. Kept structural so we don't import the sidecar type
// into this pure module.
export interface BwfSidecarFields {
  tmtId: number
  tournamentCode: string
  slug: string
  name: string
  startDateIso: string
  endDateIso: string
}

// A "YYYY-MM-DD HH:MM:SS" (or already-ISO) datetime → the date part. Anything
// that doesn't start with a date collapses to '' so the sidecar stays lenient.
function isoDateOnly(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return m ? m[1] : ''
}

// Fallback for when the HTML page is Cloudflare-challenged: the extranet API's
// vue-tournament-detail (keyed by tmtId, no HTML scrape) returns the same
// identity fields. Map its `results` object into sidecar fields. Returns null
// unless every required identity field (id, code, name, slug) is present.
export function sidecarFieldsFromDetail(results: unknown): BwfSidecarFields | null {
  if (!results || typeof results !== 'object') return null
  const r = results as Record<string, unknown>
  const id = typeof r.id === 'number' ? r.id : typeof r.id === 'string' ? Number(r.id) : NaN
  const code = typeof r.code === 'string' ? r.code : ''
  const name = typeof r.name === 'string' ? r.name : ''
  const slug = typeof r.slug === 'string' ? r.slug : ''
  if (!Number.isFinite(id) || !code || !name || !slug) return null
  return {
    tmtId: id,
    tournamentCode: code.toUpperCase(),
    slug,
    name,
    startDateIso: isoDateOnly(r.start_date),
    endDateIso: isoDateOnly(r.end_date),
  }
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

const SAME_MONTH = /class="live-date">\s*(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/
const CROSS_MONTH = /class="live-date">\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/
const YEAR_FROM_SLUG = /tournamentSlug\s*:\s*['"][^'"]*?(\d{4})['"]/

export function extractDatesFromPageHtml(html: string): { startDateIso: string; endDateIso: string } | null {
  const year = YEAR_FROM_SLUG.exec(html)?.[1]
  if (!year) return null

  const cross = CROSS_MONTH.exec(html)
  if (cross) {
    const m1 = MONTHS[cross[2].slice(0, 3).toLowerCase()]
    const m2 = MONTHS[cross[4].slice(0, 3).toLowerCase()]
    if (!m1 || !m2) return null
    return {
      startDateIso: `${year}-${m1}-${cross[1].padStart(2, '0')}`,
      endDateIso: `${year}-${m2}-${cross[3].padStart(2, '0')}`,
    }
  }

  const same = SAME_MONTH.exec(html)
  if (same) {
    const m = MONTHS[same[3].slice(0, 3).toLowerCase()]
    if (!m) return null
    return {
      startDateIso: `${year}-${m}-${same[1].padStart(2, '0')}`,
      endDateIso: `${year}-${m}-${same[2].padStart(2, '0')}`,
    }
  }

  return null
}
