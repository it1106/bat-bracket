import fs from 'fs'
import path from 'path'
import { parseBracketFeeders } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

const THATCHATHAM_ID = '2832' // ธัชธรรม์ เหมาะประสิทธิ์ วรสุภาพ
const RONAKORN_ID    = '3512' // รณกร รัตนบัญญัติ
const RYAN_ID        = '2585' // Wong Hao Feng RYAN

describe('parseBracketFeeders', () => {
  it('returns empty array when no bracket markup is present', () => {
    expect(parseBracketFeeders('<html><body>not a bracket</body></html>')).toEqual([])
  })

  it('emits one entry per R+1 slot with both child matches attached', () => {
    const html = fixtureHtml('bracket-bat-ysb-bsu13.html')
    const entries = parseBracketFeeders(html)

    const r64 = entries.find((e) => e.players.includes(THATCHATHAM_ID))
    expect(r64).toBeDefined()
    expect(r64!.childMatches).toHaveLength(2)

    const childIds = r64!.childMatches.map((child) =>
      child.flat().map((p) => p.playerId),
    )
    const selfChild = childIds.find((ids) => ids.includes(THATCHATHAM_ID))
    const otherChild = childIds.find((ids) => !ids.includes(THATCHATHAM_ID))
    expect(selfChild).toBeDefined()
    expect(otherChild).toBeDefined()
    expect(otherChild!.sort()).toEqual([RONAKORN_ID, RYAN_ID].sort())
  })

  it('emits sorted player IDs as the join key', () => {
    const html = fixtureHtml('bracket-bat-ysb-bsu13.html')
    const entries = parseBracketFeeders(html)
    for (const e of entries) {
      const sorted = [...e.players].sort()
      expect(e.players).toEqual(sorted)
    }
  })
})
