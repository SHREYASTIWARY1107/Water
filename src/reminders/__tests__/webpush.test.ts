import { describe, expect, it } from 'vitest'
import {
  b64urlDecode,
  b64urlEncode,
  concat,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from '../../../supabase/functions/_shared/webpush'

const te = new TextEncoder()
const td = new TextDecoder()

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, len * 8))
}

/** Receiver-side (browser) decryption written independently from the sender. */
async function decryptAsBrowser(body: Uint8Array, uaKeys: CryptoKeyPair, authSecret: Uint8Array) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey))
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as EcdhKeyDeriveParams, uaKeys.privateKey, 256))
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  // strip padding: last non-zero byte must be the 0x02 final-record delimiter
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  expect(padded[end]).toBe(2)
  return { rs, idlen, text: td.decode(padded.slice(0, end)) }
}

describe('web push (RFC 8291 / 8292)', () => {
  it('encrypts a payload the browser can decrypt', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const payload = JSON.stringify({ title: 'Time to hydrate 💧', body: '1.2 of 2.5 L' })

    const body = await encryptPayload(te.encode(payload), b64urlEncode(uaPublic), b64urlEncode(auth))
    const out = await decryptAsBrowser(body, ua, auth)
    expect(out).toEqual({ rs: 4096, idlen: 65, text: payload })
    // header(86) + plaintext + delimiter(1) + GCM tag(16)
    expect(body.length).toBe(86 + te.encode(payload).length + 1 + 16)
  })

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload(te.encode('x'), 'AAAA', b64urlEncode(new Uint8Array(16)))).rejects.toThrow(/p256dh/)
  })

  it('produces a valid ES256 VAPID JWT', async () => {
    const vapid = await generateVapidKeys()
    expect(b64urlDecode(vapid.publicKey)).toHaveLength(65)
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH', vapid, 'https://example.org/app/')
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    expect(m).toBeTruthy()
    const claims = JSON.parse(td.decode(b64urlDecode(m[2])))
    expect(claims.aud).toBe('https://web.push.apple.com')
    expect(claims.sub).toBe('https://example.org/app/')
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000)
    expect(m[4]).toBe(vapid.publicKey)

    const pub = await crypto.subtle.importKey('raw', b64urlDecode(vapid.publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64urlDecode(m[3]) as BufferSource,
      te.encode(`${m[1]}.${m[2]}`),
    )
    expect(valid).toBe(true)
  })
})
