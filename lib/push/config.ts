export interface PushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

/** The push settings, or null when any is missing: the feature is then off. */
export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim()
  const subject = (env.VAPID_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null
  return { publicKey, privateKey, subject }
}
