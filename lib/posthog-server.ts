import { PostHog } from 'posthog-node'

const HOST = 'https://eu.i.posthog.com'
const SERVER_DISTINCT_ID = 'bat-bracket-server'

let client: PostHog | null = null
let initialized = false

function getClient(): PostHog | null {
  if (initialized) return client
  initialized = true
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!apiKey) return null
  // flushAt:1 sends every event immediately — this code path is low volume
  // (a few events per day) so batching gains nothing.
  client = new PostHog(apiKey, { host: HOST, flushAt: 1, flushInterval: 0 })
  return client
}

export async function captureServerEvent(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    const c = getClient()
    if (!c) return
    c.capture({
      distinctId: SERVER_DISTINCT_ID,
      event,
      properties: {
        ...properties,
        $process_person_profile: false,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[posthog-server] capture failed: ${msg}`)
  }
}

// Test-only: drop cached client so env-var changes between tests take effect.
export function _resetForTest(): void {
  if (client) {
    client.shutdown().catch(() => {})
  }
  client = null
  initialized = false
}
