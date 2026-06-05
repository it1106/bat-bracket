import fs from 'fs'
import os from 'os'
import path from 'path'
import { POST } from '@/app/api/ranking/[provider]/refresh/route'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrf-'))
  __setRankingCacheRootForTesting(dir)
})

describe('POST /api/ranking/[provider]/refresh', () => {
  it('rejects unknown provider', async () => {
    const req = new Request('http://x/api/ranking/foo/refresh', { method: 'POST' })
    const res = await POST(req, { params: { provider: 'foo' } })
    expect(res.status).toBe(400)
  })
})
