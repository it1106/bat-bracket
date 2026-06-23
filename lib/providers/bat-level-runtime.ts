import { batFetch } from '@/lib/bat-fetch'
import { readMeta, patchMeta } from '@/lib/tournament-meta'

// Fire-and-forget population of the BAT tournament level into the meta sidecar,
// mirroring resolveBwfUrl: the /api/tournaments route triggers this in the
// background for level-less BAT entries, so the dropdown returns immediately
// and the next load shows the level. An in-flight guard plus the persisted
// `levelChecked` sentinel prevent a re-fetch storm against BAT.

const inFlight = new Set<string>()

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // The regulations content is a js-asyncmodal partial: BAT returns a 404 page
  // unless the request is flagged as XHR.
  'X-Requested-With': 'XMLHttpRequest',
  'Accept': 'text/html, */*; q=0.01',
}

// Parse the level (1-6) from the regulations partial. Organizers write it as
// free text, e.g. "เก็บคะแนนสะสมระดับ Level 2" or "ในระดับ LEVEL 2"; the Latin
// "Level N" is the reliable signal, with the Thai "ระดับ N" as a fallback.
// Returns null when no level is mentioned (some regulations omit it).
export function parseLevel(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, ' ')
  const en = text.match(/level\s*(\d)/i)
  if (en) return Number(en[1])
  const th = text.match(/ระดับ\s*(\d)/)
  if (th) return Number(th[1])
  return null
}

export async function resolveBatLevel(id: string): Promise<void> {
  if (inFlight.has(id)) return
  const meta = await readMeta(id)
  if (meta?.levelChecked) return
  inFlight.add(id)
  try {
    const url = `https://bat.tournamentsoftware.com/tournament/${id}/Home/Regulations`
    const res = await batFetch('regulations', url, {
      headers: { ...HEADERS, Referer: `https://bat.tournamentsoftware.com/tournament/${id}` },
    })
    // Leave levelChecked unset on a transport failure so a later load retries.
    if (!res.ok) return
    const html = await res.text()
    const level = parseLevel(html)
    await patchMeta(id, { levelChecked: true, ...(level != null && { level }) })
    console.log('[bat-level] resolved', id, '→ level=' + (level ?? 'none'))
  } catch (err) {
    console.warn('[bat-level] failed for', id, err)
  } finally {
    inFlight.delete(id)
  }
}
