import type { DrawInfo, MatchEntry } from './types'

export interface PathDraw {
  drawNum: string
  name: string
}

/** The knockout draws a player has matches in — the draws a path to the final
 *  can be shown for. A draw is kept only when the tournament's draw list says
 *  it is an elimination draw; group draws and anything unknown are left out,
 *  so the button never opens onto an error. */
export function knockoutDrawsOf(matches: MatchEntry[], draws: DrawInfo[] | undefined): PathDraw[] {
  const out: PathDraw[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (!m.drawNum || seen.has(m.drawNum)) continue
    seen.add(m.drawNum)
    const d = draws?.find((x) => x.drawNum === m.drawNum)
    if (!d || d.groupLetter) continue
    if (!/^elimination$/i.test((d.type ?? '').trim())) continue
    out.push({ drawNum: m.drawNum, name: d.name || m.draw })
  }
  return out
}
