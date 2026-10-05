/**
 * Generates a new wallet for use on testnet/devnet and writes the PEM.
 *
 * Usage: npm run wallet:new [-- path.pem] [--password password]
 *   - without arguments writes to backend/wallet.pem (default of WALLET_PEM_PATH)
 *   - never overwrites an existing file
 *   - with --password the PEM is written encrypted (AES-256-GCM), in the same format
 *     that klever-connect's `loadPrivateKeyFromPemFile` reads
 *
 * Klever format (same as koperator's): base64 of the hex string `privkey||pubkey`,
 * header `PRIVATE KEY for <address>`.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { generateKeyPair } from '@klever/connect'

import { fromPackageRoot } from '../src/lib/paths.js'

const { values, positionals } = parseArgs({
  options: { password: { type: 'string' } },
  allowPositionals: true,
})

const outPath = fromPackageRoot(positionals[0] ?? 'wallet.pem')
const { privateKey, publicKey } = await generateKeyPair()
const address = publicKey.toAddress()

const keyBytes = Buffer.concat([privateKey.bytes, publicKey.bytes])

const headers: string[] = []
let body = keyBytes
if (values.password) {
  // Same scheme as klever-connect's decryptPemBlock: key = SHA-256(password),
  // data = nonce(12) || ciphertext || tag(16).
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(values.password).digest(), nonce)
  body = Buffer.concat([nonce, cipher.update(keyBytes), cipher.final(), cipher.getAuthTag()])
  headers.push(`DEK-Info: AES-GCM,${nonce.toString('hex')}`, '')
}

const base64 = Buffer.from(body.toString('hex')).toString('base64')
const pem = [
  `-----BEGIN PRIVATE KEY for ${address}-----`,
  ...headers,
  ...(base64.match(/.{1,64}/g) ?? []),
  `-----END PRIVATE KEY for ${address}-----`,
  '',
].join('\n')

writeFileSync(outPath, pem, { flag: 'wx', mode: 0o600 })

console.log(`
  Wallet generated (use ONLY on testnet/devnet)
  ────────────────────────────────────────────────
  address        ${address}
  public key     ${publicKey.hex}
  file           ${outPath}${values.password ? ' (encrypted)' : ''}

  No .env:
  WALLET_PEM_PATH=${positionals[0] ?? './wallet.pem'}${values.password ? '\n  WALLET_PEM_PASSWORD=<the password used>' : ''}

  Testnet faucet: https://testnet.kleverscan.org/faucet
`)
