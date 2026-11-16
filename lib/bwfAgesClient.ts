// Asks /api/bwf/player-ages for a list of players, in the browser.
//
// The server looks up only so many unknown players per request and leaves the
// rest out of its answer. This asks again for whoever was left out until
// everyone is answered, handing each batch over as it arrives so ages fill in
// as they come. It stops when a request brings nothing new (those players
// cannot be answered right now) or fails.

export interface BwfAge {
  age: number | null
  dob: string | null
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

// The server takes at most this many ids from one request.
const IDS_PER_REQUEST = 400
// A full day is a few requests; this only stops a loop that should not happen.
const MAX_REQUESTS = 40

export async function fetchBwfAges(
  ids: string[],
  opts: {
    fetchFn?: FetchLike
    onBatch?: (ages: Record<string, BwfAge>) => void
    cancelled?: () => boolean
  } = {},
): Promise<Record<string, BwfAge>> {
  const fetchFn: FetchLike = opts.fetchFn ?? ((url) => fetch(url))
  const all: Record<string, BwfAge> = {}
  let pending = Array.from(new Set(ids.filter(Boolean)))

  for (let request = 0; request < MAX_REQUESTS && pending.length > 0; request++) {
    if (opts.cancelled?.()) break
    const asked = pending.slice(0, IDS_PER_REQUEST)
    let data: Record<string, BwfAge>
    try {
      const res = await fetchFn(`/api/bwf/player-ages?ids=${encodeURIComponent(asked.join(','))}`)
      if (!res.ok) break
      data = ((await res.json()) ?? {}) as Record<string, BwfAge>
    } catch {
      break
    }
    if (opts.cancelled?.()) break

    const batch: Record<string, BwfAge> = {}
    for (const id of asked) {
      const info = data[id]
      if (info && typeof info === 'object') batch[id] = info
    }
    // Nothing new: whoever is left cannot be answered now. Asking again
    // would only repeat the question.
    if (Object.keys(batch).length === 0) break
    Object.assign(all, batch)
    opts.onBatch?.(batch)
    pending = pending.filter((id) => !(id in batch))
  }
  return all
}
