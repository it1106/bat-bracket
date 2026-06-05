import { batFetch } from '@/lib/bat-fetch'
import { getRankingConfig } from './config'
import type { ProviderTag } from '@/lib/types'

/** Thin wrapper around batFetch that injects the provider's headers (UA
 *  for BAT, UA + cookiewall-bypass cookie for BWF). `kind` is the tag
 *  recorded in [bat-fetch] log lines — prefix with `ranking-{provider}-`
 *  so logs distinguish the two upstreams. */
export async function rankingFetch(
  provider: ProviderTag,
  kind: string,
  url: string,
): Promise<Response> {
  const cfg = getRankingConfig(provider)
  return batFetch(`ranking-${provider}-${kind}`, url, { headers: cfg.headers })
}
