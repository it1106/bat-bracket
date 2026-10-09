import { isPushEndpoint, isGuid, parseSubscription, parseTarget } from '@/lib/push/validate'
import { pushConfig } from '@/lib/push/config'

const TID = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('isPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGk',
    'https://api.push.apple.com/3/device/x',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-sg2p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (url) => { expect(isPushEndpoint(url)).toBe(true) })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/fcm/send/abc',
    'https://evil.example/fcm.googleapis.com',
    'https://push.apple.com.evil.example/x',
    'https://127.0.0.1/x',
    'https://localhost:3000/api/bmstats',
    'not a url',
    '',
    5,
    null,
  ])('rejects %p', (url) => { expect(isPushEndpoint(url)).toBe(false) })

  it('rejects an address longer than 1000 characters', () => {
    expect(isPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(1000)}`)).toBe(false)
  })
})

describe('parseSubscription', () => {
  const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url')
  const AUTH = Buffer.alloc(16, 9).toString('base64url')
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: P256DH, auth: AUTH } }
  it('keeps the endpoint and the two keys, nothing else', () => {
    expect(parseSubscription({ ...good, expirationTime: null, extra: 1 })).toEqual(good)
  })
  it.each([
    null, 'x', {}, { endpoint: 'https://evil.example/x', keys: good.keys },
    { endpoint: good.endpoint }, { endpoint: good.endpoint, keys: { p256dh: 'x' } },
    { endpoint: good.endpoint, keys: { p256dh: 5, auth: 'x' } },
    { endpoint: good.endpoint, keys: { p256dh: 'x'.repeat(300), auth: 'x' } },
  ])('rejects %p', (v) => { expect(parseSubscription(v)).toBeNull() })

  it('rejects keys that are not what a browser produces', () => {
    const with_ = (keys: Record<string, string>) => parseSubscription({ endpoint: good.endpoint, keys: { ...good.keys, ...keys } })
    expect(with_({ p256dh: 'BPk' })).toBeNull()
    expect(with_({ p256dh: Buffer.alloc(65, 7).toString('base64url') })).toBeNull() // not an uncompressed point
    expect(with_({ p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(63, 7)]).toString('base64url') })).toBeNull()
    expect(with_({ auth: 'q1' })).toBeNull()
    expect(with_({ auth: Buffer.alloc(15, 9).toString('base64url') })).toBeNull()
    expect(with_({ auth: 'not base64 !!' })).toBeNull()
  })

  it('accepts ordinary base64 as well as the URL-safe kind', () => {
    const std = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0xfb)]).toString('base64')
    expect(parseSubscription({ endpoint: good.endpoint, keys: { p256dh: std, auth: good.keys.auth } })).not.toBeNull()
  })
})

describe('parseTarget', () => {
  it('reads a player target and trims the name', () => {
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42', playerName: '  Anan Dee ' }, true))
      .toEqual({ kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42', playerName: 'Anan Dee' })
  })
  it('needs a name to follow a player, not to unfollow', () => {
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42' }, true)).toBeNull()
    expect(parseTarget({ kind: 'player', tournamentId: TID, playerId: '42' }, false))
      .toEqual({ kind: 'player', tournamentId: TID.toUpperCase(), playerId: '42' })
  })
  it('reads a club target', () => {
    expect(parseTarget({ kind: 'club', tournamentId: TID, clubName: ' Red  Club ' }, true))
      .toEqual({ kind: 'club', tournamentId: TID.toUpperCase(), clubName: 'Red Club' })
  })
  it.each([
    null, {}, { kind: 'country', tournamentId: TID },
    { kind: 'player', tournamentId: 'nope', playerId: '1', playerName: 'A' },
    { kind: 'player', tournamentId: TID, playerId: '1;x', playerName: 'A' },
    { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'A'.repeat(121) },
    { kind: 'club', tournamentId: TID, clubName: '   ' },
    { kind: 'club', tournamentId: TID, clubName: 'C'.repeat(121) },
  ])('rejects %p', (v) => { expect(parseTarget(v, true)).toBeNull() })
  it('knows a GUID', () => {
    expect(isGuid(TID)).toBe(true)
    expect(isGuid(TID.toUpperCase())).toBe(true)
    expect(isGuid('abc')).toBe(false)
  })
})

describe('pushConfig', () => {
  const full = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' }
  it('is the three settings when all are there', () => {
    expect(pushConfig(full as never)).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' })
  })
  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])('is off without %s', (k) => {
    expect(pushConfig({ ...full, [k]: '' } as never)).toBeNull()
    expect(pushConfig({ ...full, [k]: '   ' } as never)).toBeNull()
  })
  it('is off when the subject is not a mailto: or https: address', () => {
    expect(pushConfig({ ...full, VAPID_SUBJECT: 'someone' } as never)).toBeNull()
  })
})
