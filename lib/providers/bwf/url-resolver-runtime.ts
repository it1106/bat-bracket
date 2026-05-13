import { fetchPageHtml } from './cf-context'
import { extractMetaFromPageHtml, extractDatesFromPageHtml } from './url-resolver'
import { saveSidecarEntry, lookupByUrl } from './sidecar'

const inFlight = new Set<string>()

export async function resolveBwfUrl(url: string): Promise<void> {
  if (lookupByUrl(url) || inFlight.has(url)) return
  inFlight.add(url)
  try {
    const html = await fetchPageHtml(url)
    const meta = extractMetaFromPageHtml(html)
    if (!meta) { console.warn('[bwf-resolve] could not extract meta from', url); return }
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
  } catch (err) {
    console.warn('[bwf-resolve] failed for', url, err)
  } finally {
    inFlight.delete(url)
  }
}
