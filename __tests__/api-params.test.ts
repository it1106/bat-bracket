import { isTournamentId, isScheduleDate, isDrawNum, isPlayerId } from '@/lib/api-params'

// These values go straight into addresses the server asks BAT and BWF for.
describe('api params', () => {
  it.each([
    ['A97008D7-AA53-44AA-9BB7-2A6A2734EA47', true],
    ['a97008d7-aa53-44aa-9bb7-2a6a2734ea47', true],
    ['', false],
    ['abc123', false],
    ['A97008D7-AA53-44AA-9BB7-2A6A2734EA47/../../sport', false],
    ['../../sport/admin', false],
    ['A97008D7-AA53-44AA-9BB7-2A6A2734EA47?x=1', false],
    [' A97008D7-AA53-44AA-9BB7-2A6A2734EA47', false],
    [null, false],
    [undefined, false],
  ])('tournament id %j → %s', (value, want) => {
    expect(isTournamentId(value)).toBe(want)
  })

  it.each([
    ['25691102', true],      // BAT: Buddhist-year YYYYMMDD
    ['2026-11-02', true],    // BWF: ISO
    ['20261102&x=1', false],
    ['2026-11-02T00:00', false],
    ['../x', false],
    ['2569110', false],
    ['', false],
    [null, false],
  ])('schedule date %j → %s', (value, want) => {
    expect(isScheduleDate(value)).toBe(want)
  })

  it.each([
    ['1', true], ['23', true], ['123456', true],
    ['1234567', false], ['1/../2', false], ['1&x=2', false], ['-1', false], ['abc', false], ['', false], [null, false],
  ])('draw number %j → %s', (value, want) => {
    expect(isDrawNum(value)).toBe(want)
  })

  it.each([
    ['7', true], ['52194396', true], ['123456789012', true],
    ['1234567890123', false], ['7&player=8', false], ['x', false], ['', false], [null, false],
  ])('player id %j → %s', (value, want) => {
    expect(isPlayerId(value)).toBe(want)
  })
})
