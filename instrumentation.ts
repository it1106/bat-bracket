export async function register() {
  // Only run in the Node.js runtime (not edge), and only on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    // Fire-and-forget: pre-fetch all draws in the background at startup
    prewarmDrawsCache().catch((err) => console.warn('[instrumentation] prewarm error:', err))
  }
}
