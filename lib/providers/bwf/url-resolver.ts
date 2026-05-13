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
  token: /\btoken\s*:\s*["']([^"']+)["']/,
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
