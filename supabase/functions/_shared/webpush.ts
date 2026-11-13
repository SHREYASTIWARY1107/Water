/**
 * Minimal, dependency-free Web Push for Deno / browsers / Node 20+ (WebCrypto only).
 *  - Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
 *  - Authorization:      RFC 8292 VAPID (ES256 JWT)
 * Works with Apple (iOS/macOS Safari), Google FCM (Chrome/Edge/Android) and Mozilla push services.
 */

export interface PushSubscriptionKeys {
  endpoint: string
  p256dh: string // base64url, 65-byte uncompressed P-256 point
  auth: string // base64url, 16 bytes
}

export interface VapidKeys {
  publicKey: string // base64url uncompressed point (what browsers use as applicationServerKey)
  privateJwk: JsonWebKey
}

const te = new TextEncoder()

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

/** Generate a fresh VAPID key pair. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: b64urlEncode(raw), privateJwk }
}

/** RFC 8291 encryption. Returns the aes128gcm body (header + single record). */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  authSecretB64: string,
  // Overridable for tests only.
  opts: { salt?: Uint8Array; serverKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh)
  const authSecret = b64urlDecode(authSecretB64)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh key')
  if (authSecret.length !== 16) throw new Error('invalid auth secret')

  const asKeys =
    opts.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, asKeys.privateKey, 256),
  )

  const ikm = await hkdf(authSecret, ecdhSecret, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)

  // Single final record: plaintext || 0x02 delimiter (no extra padding).
  const record = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, record as BufferSource),
  )

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, ciphertext)
}

/** RFC 8292 VAPID JWT for the push service origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, subject: string, ttlSeconds = 12 * 3600) {
  const aud = new URL(endpoint).origin
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(
    te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + ttlSeconds, sub: subject })),
  )
  const unsigned = `${header}.${claims}`
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // WebCrypto returns the raw r||s (IEEE P1363) signature that JWS ES256 expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)))
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${vapid.publicKey}`
}

export interface SendResult {
  status: number
  ok: boolean
  /** Subscription is permanently invalid and should be deleted. */
  gone: boolean
  body?: string
}

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  subject: string,
  { ttl = 3600, urgency = 'high' as 'very-low' | 'low' | 'normal' | 'high', topic }: { ttl?: number; urgency?: string; topic?: string } = {},
): Promise<SendResult> {
  const body = await encryptPayload(te.encode(JSON.stringify(payload)), sub.p256dh, sub.auth)
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  }
  // A topic lets the push service replace an undelivered older reminder instead of queueing both.
  if (topic) headers.Topic = topic
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body: body as BodyInit })
  const text = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 300)
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, body: text }
}
