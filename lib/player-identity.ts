import type { PlayerIndex, PlayerIdentityMap, IdentityMatch, PlayerLink } from './types'

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1
  const l1 = s1.length, l2 = s2.length
  if (l1 === 0 || l2 === 0) return 0
  const matchDist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
  const s1m = new Array<boolean>(l1).fill(false)
  const s2m = new Array<boolean>(l2).fill(false)
  let matches = 0
  for (let i = 0; i < l1; i++) {
    const start = Math.max(0, i - matchDist)
    const end = Math.min(i + matchDist + 1, l2)
    for (let j = start; j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue
      s1m[i] = true; s2m[j] = true; matches++; break
    }
  }
  if (matches === 0) return 0
  let trans = 0, k = 0
  for (let i = 0; i < l1; i++) {
    if (!s1m[i]) continue
    while (!s2m[k]) k++
    if (s1[i] !== s2[k]) trans++
    k++
  }
  return (matches / l1 + matches / l2 + (matches - trans / 2) / matches) / 3
}

function jaroWinkler(s1: string, s2: string): number {
  const j = jaro(s1, s2)
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++; else break
  }
  return j + prefix * 0.1 * (1 - j)
}

// Average best-match score for each token in the shorter name against all tokens in the longer name.
// Much stricter than single-best-pair: "ying" vs "yingluck kokarat" scores ~0.55, not 0.90.
function alignedTokenScore(a: string, b: string): number {
  const ta = a.split(/\s+/).filter(Boolean)
  const tb = b.split(/\s+/).filter(Boolean)
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  let total = 0
  for (const x of shorter) {
    let best = 0
    for (const y of longer) { const s = jaroWinkler(x, y); if (s > best) best = s }
    total += best
  }
  return total / shorter.length
}

export function computeSimilarity(a: string, b: string): number {
  const al = a.toLowerCase().trim()
  const bl = b.toLowerCase().trim()
  return Math.max(jaroWinkler(al, bl), alignedTokenScore(al, bl))
}

const THRESHOLD = 0.82

export function buildIdentityMap(
  batIndex: PlayerIndex,
  bwfIndex: PlayerIndex,
  existing: PlayerIdentityMap | null,
  links: PlayerLink[] = [],
): PlayerIdentityMap {
  // Preserve overrides and rejections; they take precedence over fresh inference
  const pinned = new Map<string, IdentityMatch>()
  for (const m of existing?.matches ?? []) {
    if (m.override || m.rejected) pinned.set(m.batSlug, m)
  }

  // Resolve human-friendly player links (Thai display name → bwf slug) into override entries
  for (const link of links) {
    const batPlayer = Object.values(batIndex.players).find(
      p => p.displayName === link.batName || p.altNames.includes(link.batName)
    )
    if (!batPlayer) {
      console.log(`[player-identity] player-links: no BAT player found for "${link.batName}"`)
      continue
    }
    if (!bwfIndex.players[link.bwfSlug]) {
      console.log(`[player-identity] player-links: no BWF player found for slug "${link.bwfSlug}"`)
      continue
    }
    pinned.set(batPlayer.key.slug, {
      batSlug: batPlayer.key.slug,
      bwfSlug: link.bwfSlug,
      confidence: 1,
      method: 'fuzzy',
      override: true,
    })
  }

  const bwfTha = Object.values(bwfIndex.players).filter(p => p.country === 'THA')

  const matches: IdentityMatch[] = Array.from(pinned.values())

  for (const batPlayer of Object.values(batIndex.players)) {
    if (pinned.has(batPlayer.key.slug)) continue
    // Only match BAT players who have Thai-script names; skip foreign players
    const allBatNames = [batPlayer.displayName, ...batPlayer.altNames].filter(Boolean)
    if (!allBatNames.some(n => /[ก-ฮ]/.test(n))) continue

    const batNames = allBatNames
    let bestScore = 0
    let bestBwfSlug = ''

    for (const bwfPlayer of bwfTha) {
      const bwfNames = [bwfPlayer.displayName, ...bwfPlayer.altNames].filter(Boolean)
      for (const bn of batNames) {
        for (const wn of bwfNames) {
          const score = computeSimilarity(bn, wn)
          if (score > bestScore) { bestScore = score; bestBwfSlug = bwfPlayer.key.slug }
        }
      }
    }

    if (bestScore >= THRESHOLD && bestBwfSlug) {
      matches.push({ batSlug: batPlayer.key.slug, bwfSlug: bestBwfSlug, confidence: bestScore, method: 'fuzzy' })
    }
  }

  return { generatedAt: '__GENERATED_AT__', matches }
}
