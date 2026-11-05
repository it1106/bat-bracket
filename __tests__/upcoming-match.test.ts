import { formatMatchTime, upcomingCourt, upcomingMatchNo } from '@/lib/upcoming-match'

describe('formatMatchTime', () => {
  it('shortens a BWF timestamp to day and time', () => {
    expect(formatMatchTime('2026-11-05 12:00:00')).toBe('05/11/26 12:00')
  })

  it('reads the ISO form BWF also sends', () => {
    expect(formatMatchTime('2026-11-05T12:00:00Z')).toBe('05/11/26 12:00')
  })

  // BAT's scheduledTime is already a readable label in the site's own
  // calendar ("Fri 15/5/2569 10:30"), so it must pass through untouched.
  it('leaves a label that is not a timestamp alone', () => {
    expect(formatMatchTime('ศ. 15/5/2569 10:30')).toBe('ศ. 15/5/2569 10:30')
  })

  it('leaves an empty string alone', () => {
    expect(formatMatchTime('')).toBe('')
  })
})

describe('upcomingCourt', () => {
  it('gives the court of a match with a settled order of play', () => {
    expect(upcomingCourt({ court: 'Court 2', sequenceLabel: '6. Followed by' })).toBe('Court 2')
  })

  // The source keeps a planned court on a match whose order-of-play line says
  // the court is not settled, exactly as in the bracket (courtIsTba there).
  it('hides the court when the order of play says it is TBA', () => {
    expect(upcomingCourt({ court: 'Court 3', sequenceLabel: '15. Court and time TBA' })).toBe('')
  })

  it('keeps the court when only the time is TBA', () => {
    expect(upcomingCourt({ court: 'Court 3', sequenceLabel: '15. Time TBA' })).toBe('Court 3')
  })

  // BAT puts "Now playing" in the court field of a match that is on court but
  // whose court it does not name.
  it('does not treat "Now playing" as a court', () => {
    expect(upcomingCourt({ court: 'Now playing', sequenceLabel: '' })).toBe('')
  })

  it('gives nothing when there is no court', () => {
    expect(upcomingCourt({ court: '', sequenceLabel: '2. Followed by' })).toBe('')
  })
})

describe('upcomingMatchNo', () => {
  it('reads the queue position off the order-of-play label', () => {
    expect(upcomingMatchNo({ court: 'Court 2', sequenceLabel: '6. Followed by' })).toBe('6')
  })

  // The number is a position in one court's queue, so it means nothing without
  // the court — the bracket drops it on the same rule.
  it('gives nothing when the court is not shown', () => {
    expect(upcomingMatchNo({ court: 'Court 3', sequenceLabel: '15. Court and time TBA' })).toBe('')
  })

  it('gives nothing when the label carries no number', () => {
    expect(upcomingMatchNo({ court: 'Court 2', sequenceLabel: 'Followed by' })).toBe('')
  })

  it('gives nothing when there is no label at all', () => {
    expect(upcomingMatchNo({ court: 'Court 2', sequenceLabel: undefined })).toBe('')
  })
})
