import { fetchPageHtml } from './cf-context'
import { fetchTournamentDetail } from './api-client'
import {
  extractMetaFromPageHtml,
  extractDatesFromPageHtml,
  parseTmtIdFromBwfUrl,
  sidecarFieldsFromDetail,
} from './url-resolver'
import { saveSidecarEntry, lookupByUrl } from './sidecar'

const inFlight = new Set<string>()

// Resolve a `@bwf` tournament URL into a sidecar entry. Primary path scrapes the
// tournament HTML page. When the scrape yields no meta we fall back to the
// extranet API's vue-tournament-detail — keyed by the tmtId parsed from the URL,
// it returns the same identity fields without any HTML scrape. Two things send
// us down the fallback:
//   - Cloudflare: since ~mid-2026 BWF bot-challenges these pages for headless
//     browsers, so there's often no real HTML to parse;
//   - a not-yet-started event: with no Results tab, the page lands on a Draw tab
//     whose <title> has no "|", so RX.name misses even on a clean 200.
// The second means an event added before its start date resolves *only* via this
// fallback — it is load-bearing, not a rare safety net.
export async function resolveBwfUrl(url: string): Promise<void> {
  if (lookupByUrl(url) || inFlight.has(url)) return
  inFlight.add(url)
  try {
    const html = await fetchPageHtml(url)
    const meta = extractMetaFromPageHtml(html)
    if (meta) {
      const dates = extractDatesFromPageHtml(html)
      saveSidecarEntry(url, {
        tmtId: meta.tmtId,
        tournamentCode: meta.tournamentCode,
        slug: meta.slug,
        name: meta.name,
        startDateIso: dates?.startDateIso ?? '',
        endDateIso: dates?.endDateIso ?? '',
        resolvedAt: new Date().toISOString(),
      })
      console.log('[bwf-resolve] resolved', url, '→ tmtId=' + meta.tmtId)
      return
    }

    // HTML scrape blocked (Cloudflare) — fall back to the extranet API.
    const tmtId = parseTmtIdFromBwfUrl(url)
    if (!tmtId) {
      console.warn('[bwf-resolve] could not extract meta and no tmtId in URL:', url)
      return
    }
    const detail = (await fetchTournamentDetail({ tmtId })) as { results?: unknown }
    const fields = sidecarFieldsFromDetail(detail?.results)
    if (!fields) {
      console.warn('[bwf-resolve] HTML blocked and detail API unusable for', url)
      return
    }
    saveSidecarEntry(url, { ...fields, resolvedAt: new Date().toISOString() })
    console.log('[bwf-resolve] resolved via detail API', url, '→ tmtId=' + fields.tmtId)
  } catch (err) {
    console.warn('[bwf-resolve] failed for', url, err)
  } finally {
    inFlight.delete(url)
  }
}
