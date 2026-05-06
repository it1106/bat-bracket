import * as cheerio from 'cheerio'

export interface UpcomingEntry {
  id: string
  name: string
  hasOnlineEntry: boolean
}

const GUID_RE = /\/sport\/tournament\?id=([A-Fa-f0-9-]{36})/i

export function parseUpcoming(html: string): UpcomingEntry[] {
  if (!html) return []
  const $ = cheerio.load(html)
  const out: UpcomingEntry[] = []
  const seen = new Set<string>()

  $('li.list__item').each((_, li) => {
    const link = $(li).find('a[href*="/sport/tournament?id="]').first()
    const href = link.attr('href') ?? ''
    const m = GUID_RE.exec(href)
    if (!m) return
    const id = m[1].toUpperCase()
    if (seen.has(id)) return
    seen.add(id)

    const name =
      $(li).find('.media__title .nav-link__value').first().text().trim() ||
      link.attr('title')?.trim() ||
      link.text().trim()
    if (!name) return

    const hasOnlineEntry =
      $(li).find('a[href*="/onlineentry/onlineentry.aspx"]').length > 0

    out.push({ id, name, hasOnlineEntry })
  })

  return out
}
