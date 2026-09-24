import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'

/**
 * A software passkey authenticator: what a browser and a platform
 * authenticator would hand back, for driving the server side of WebAuthn
 * without either. P-256, "none" attestation, discoverable, backed up.
 */

const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64url')
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest()

interface Stored {
  privateKey: KeyObject
  userHandle: string
  count: number
}

export class SoftwareAuthenticator {
  readonly credentials = new Map<string, Stored>()
  readonly origin: string

  constructor(origin: string) {
    this.origin = origin
  }

  create(options: Record<string, unknown>) {
    const rp = options.rp as { id: string }
    const user = options.user as { id: string }
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' })
    const id = randomBytes(16)
    this.credentials.set(b64(id), { privateKey, userHandle: user.id, count: 0 })

    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ])
    )
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(id.length)
    // user present, user verified, backup eligible, backed up, attested data
    const flags = Buffer.from([0x01 | 0x04 | 0x08 | 0x10 | 0x40])
    const authData = Buffer.concat([
      sha256(rp.id),
      flags,
      Buffer.alloc(4),
      Buffer.alloc(16),
      idLength,
      id,
      Buffer.from(cose),
    ])
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false })
    )
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never
    )
    return {
      id: b64(id),
      rawId: b64(id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    }
  }

  /** A copy of another authenticator's key under a credential ID nobody registered. */
  withCredentialFrom(other: SoftwareAuthenticator, id: string): this {
    const [stored] = other.credentials.values()
    this.credentials.set(Buffer.from(id).toString('base64url'), { ...stored, count: 0 })
    return this
  }

  get(options: Record<string, unknown>, credentialId = [...this.credentials.keys()][0]) {
    const stored = this.credentials.get(credentialId)!
    stored.count += 1
    const count = Buffer.alloc(4)
    count.writeUInt32BE(stored.count)
    const authData = Buffer.concat([
      sha256(String(options.rpId)),
      Buffer.from([0x01 | 0x04 | 0x08 | 0x10]),
      count,
    ])
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin, crossOrigin: false })
    )
    const signer = createSign('sha256')
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]))
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signer.sign(stored.privateKey)),
        userHandle: stored.userHandle,
      },
      clientExtensionResults: {},
    }
  }
}
