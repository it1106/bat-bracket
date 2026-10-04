import { outageEvents } from '@/lib/batOutageEvents'

describe('outageEvents', () => {
  it('is empty when there has been no outage', () => {
    expect(outageEvents([])).toEqual([])
  })

  it('logs going down and coming back as two moments, newest first', () => {
    expect(outageEvents([
      { start: '2026-10-04T16:31:21.000Z', end: '2026-10-04T17:42:13.000Z', detail: 'HTTP 500' },
    ])).toEqual([
      { at: '2026-10-04T17:42:13.000Z', type: 'up', detail: '', downSeconds: 4252 },
      { at: '2026-10-04T16:31:21.000Z', type: 'down', detail: 'HTTP 500', downSeconds: null },
    ])
  })

  it('logs only the going down of an outage still in progress', () => {
    expect(outageEvents([{ start: '2026-10-04T16:31:21.000Z', end: null, detail: 'no answer' }])).toEqual([
      { at: '2026-10-04T16:31:21.000Z', type: 'down', detail: 'no answer', downSeconds: null },
    ])
  })

  it('interleaves several outages by time whatever order they come in', () => {
    const events = outageEvents([
      { start: '2026-10-01T01:00:00.000Z', end: '2026-10-01T01:10:00.000Z', detail: 'HTTP 500' },
      { start: '2026-10-03T05:00:00.000Z', end: null, detail: 'HTTP 403' },
      { start: '2026-10-02T02:00:00.000Z', end: '2026-10-02T02:01:00.000Z', detail: 'no answer' },
    ])
    expect(events.map((e) => `${e.type} ${e.at.slice(5, 16)}`)).toEqual([
      'down 10-03T05:00', 'up 10-02T02:01', 'down 10-02T02:00', 'up 10-01T01:10', 'down 10-01T01:00',
    ])
  })
})
