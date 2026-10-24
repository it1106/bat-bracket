'use client'

import { useState } from 'react'
import { percentLabel, type DonutSlice } from '@/lib/donut'

const num = (n: number) => n.toLocaleString('en-US')

// The ring is drawn in units of 100 around (pathLength), so a slice's length
// is its percentage. RADIUS and WIDTH are in the viewBox's own units.
const SIZE = 120
const RADIUS = 46
const WIDTH = 14
/** The surface-coloured space between slices, in the same units of 100. */
const GAP = 0.7
/** A sliver is still drawn this long, so a slice with a few in it shows. */
const MIN_ARC = 0.5

/** Today's figures split some way — by country, by device — as a donut for the
 *  share at a glance, beside the numbers it is drawn from. The slices come
 *  ready-made from lib/countryDonut or lib/platformDonut. */
export default function StatDonut({ slices, noun = 'request', category }: {
  slices: DonutSlice[]
  /** What one unit is, singular: "request", "user". */
  noun?: string
  /** What the slices are, singular: "country", "device". Heads the table and
   *  tells a screen reader what the ring divides. */
  category: string
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  if (slices.length === 0) return null
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  const shown = slices.find((s) => s.key === hovered) ?? null
  const readout = shown
    ? `${shown.name} — ${num(shown.count)} ${noun}${shown.count === 1 ? '' : 's'} (${percentLabel(shown.percent)})`
    : `${slices[0].name} is ${percentLabel(slices[0].percent)} of ${num(total)} ${noun}${total === 1 ? '' : 's'}`

  let start = 0
  const arcs = slices.map((s) => {
    const at = start
    start += s.percent
    // One slice is the whole ring: no gap to cut out of it.
    const length = slices.length === 1 ? 100 : Math.max(MIN_ARC, s.percent - GAP)
    return { ...s, at, length }
  })

  return (
    <div className="bms-donut-wrap" onMouseLeave={() => setHovered(null)}>
      <div className="bms-donut">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Today's ${noun}s by ${category}. ${slices.map((s) => `${s.name} ${percentLabel(s.percent)}`).join(', ')}.`}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map((a) => (
              <circle
                key={a.key}
                className={`bms-donut-arc bms-c${a.slot}${hovered && hovered !== a.key ? ' bms-donut-arc--dim' : ''}`}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={WIDTH}
                pathLength={100}
                strokeDasharray={`${a.length} ${100 - a.length}`}
                strokeDashoffset={-a.at}
                onMouseEnter={() => setHovered(a.key)}
                onClick={() => setHovered(a.key)}
              />
            ))}
          </g>
          <text x={SIZE / 2} y={SIZE / 2 - 1} textAnchor="middle" className="bms-donut-total">{num(total)}</text>
          <text x={SIZE / 2} y={SIZE / 2 + 13} textAnchor="middle" className="bms-donut-caption">today</text>
        </svg>
      </div>
      <div className="bms-donut-side">
        <div className="bms-chart-readout" aria-live="off">{readout}</div>
        <table className="bms-table bms-countries">
          <thead>
            <tr>
              <th scope="col" className="bms-th">{category.charAt(0).toUpperCase() + category.slice(1)}</th>
              <td className="bms-th">{noun.charAt(0).toUpperCase() + noun.slice(1)}s</td>
              <td className="bms-th">Share</td>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr
                key={s.key}
                className={hovered === s.key ? 'bms-row--on' : undefined}
                onMouseEnter={() => setHovered(s.key)}
              >
                <th scope="row">
                  <span className={`bms-swatch bms-c${s.slot}`} aria-hidden="true" />
                  {s.name}
                </th>
                <td>{num(s.count)}</td>
                <td className="bms-share">{percentLabel(s.percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
