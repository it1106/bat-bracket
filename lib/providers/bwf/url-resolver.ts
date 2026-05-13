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
